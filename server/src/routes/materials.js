/**
 * materials.js — Học liệu (giáo án / giáo trình / slide) — docs/API.md §8, ARCHITECTURE.md §5.4.
 *
 * Hai khu vực:
 *   - official: kho chuẩn — chỉ admin/manager tải lên, mọi người đã đăng nhập đều xem.
 *   - teacher : bài của giáo viên/trợ giảng — thấy bài của MÌNH + bài đã duyệt trong
 *               phạm vi trường; manager thấy mọi bài trong phạm vi; admin thấy tất.
 * Mỗi lần tải tệp tạo một material_versions mới — giữ trọn lịch sử phiên bản.
 *
 * Tải về hàng loạt (GET /api/materials/zip): đóng gói tệp phiên bản mới nhất theo
 * cây thư mục Giải pháp › Khối › Loại (hoặc › Bài), kèm tệp Excel danh mục.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import yazl from 'yazl';
import { rows, one, scalar, tx, query } from '../db.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { assertPerm, requirePerm } from '../lib/rbac.js';
import { visibleSchoolIds, combine, assertSchoolAccess, assertClassAccess } from '../lib/scope.js';
import { str, int, uuid, uuidList, bool, enumOf, paging } from '../lib/validate.js';
import { consumeMultipart, deleteFile, absPath, contentDisposition } from '../lib/storage.js';
import { notify, notifySchoolManagers, notifyFieldStaff } from '../lib/notify.js';
import { xlsxBuffer, formatVN, LABELS } from '../lib/xlsx.js';
import { audit } from '../lib/audit.js';

const LEVELS = ['primary', 'secondary', 'highschool'];
const AREAS = ['official', 'teacher'];

// Giới hạn một lần tải ZIP — vượt thì yêu cầu thu hẹp theo khối/loại.
const MAX_ZIP_ITEMS = 500;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/**
 * Điều kiện lọc dùng chung cho danh sách và tải ZIP — cùng bộ lọc nên tải về đúng
 * những gì đang thấy. Chọn giải pháp gốc ⇒ gồm luôn các giải pháp con của nó.
 * `p(v)` đẩy tham số và trả về placeholder ($n).
 */
function listConditions(q, me, p) {
  const conds = ['not m.is_archived'];

  const area = enumOf(q.area, 'area', AREAS);
  if (area) conds.push(`m.area = ${p(area)}`);
  const level = enumOf(q.level, 'level', LEVELS);
  if (level) conds.push(`m.level = ${p(level)}`);
  const subject = str(q.subject, 'subject', { max: 200 });
  if (subject) conds.push(`m.subject ilike ${p(subject)}`); // so khớp không phân biệt hoa thường
  const schoolId = uuid(q.school_id, 'school_id');
  if (schoolId) conds.push(`m.school_id = ${p(schoolId)}`);
  const classId = uuid(q.class_id, 'class_id');
  if (classId) conds.push(`m.class_id = ${p(classId)}`);
  const solutionId = uuid(q.solution_id, 'solution_id');
  if (solutionId) {
    const s = p(solutionId);
    conds.push(`m.solution_id in (select id from solutions where id = ${s} or parent_id = ${s})`);
  }
  const grade = int(q.grade, 'grade', { min: 1, max: 12 });
  if (grade !== null) conds.push(`m.grade = ${p(grade)}`);
  const typeId = uuid(q.type_id, 'type_id');
  if (typeId) conds.push(`m.type_id = ${p(typeId)}`);
  const typeIds = uuidList(q.type_ids, 'type_ids');
  if (typeIds.length) conds.push(`m.type_id = any(${p(typeIds)}::uuid[])`);
  const ids = uuidList(q.ids, 'ids');
  if (ids.length > MAX_ZIP_ITEMS) {
    throw badRequest(`Chọn tối đa ${MAX_ZIP_ITEMS} tài liệu mỗi lần (đang chọn ${ids.length}).`);
  }
  if (ids.length) conds.push(`m.id = any(${p(ids)}::uuid[])`);
  const search = str(q.q, 'q', { max: 200 });
  if (search) {
    const like = p(`%${search}%`);
    conds.push(`(m.title ilike ${like} or m.description ilike ${like}
                 or m.lesson_title ilike ${like} or m.curriculum ilike ${like})`);
  }
  if (bool(q.mine, 'mine', { def: false })) conds.push(`m.owner_id = ${p(me.id)}`);
  return conds;
}

/* ------------------------------ Đóng gói ZIP ------------------------------ */

/** Tên thư mục/tệp dùng được trên Windows lẫn macOS. */
function safeSeg(s, fallback) {
  let out = String(s ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `_${out}`;
  return out || fallback;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Đường dẫn của một học liệu trong ZIP (chưa gồm đuôi tệp).
 * group='type'  : Giải pháp / [Giải pháp con] / Khối 06 / Slide giảng dạy / Tiết 05 - Tên bài - Tiêu đề
 * group='lesson': Giải pháp / [Giải pháp con] / Khối 06 / Tiết 05 - Tên bài / Slide giảng dạy - Tiêu đề
 */
function zipBasePath(m, group) {
  const dirs = [safeSeg(m.solution_parent_name || m.solution_name, 'Chưa gắn giải pháp')];
  if (m.solution_parent_name) dirs.push(safeSeg(m.solution_name, 'Khác'));
  dirs.push(m.grade ? `Khối ${pad2(m.grade)}` : 'Chưa phân khối');

  const tiet = m.lesson_no ? `Tiết ${pad2(m.lesson_no)}` : null;
  const lesson = [tiet, m.lesson_title].filter(Boolean).join(' - ');
  const type = safeSeg(m.type_name, 'Tài liệu khác');
  let name;
  if (group === 'lesson') {
    dirs.push(safeSeg(lesson, 'Chưa phân tiết'));
    name = `${type} - ${m.title}`;
  } else {
    dirs.push(type);
    // Tiêu đề thường đã chứa tên bài ⇒ không lặp lại cho tên tệp gọn.
    const lower = (s) => String(s || '').toLowerCase();
    const inTitle = m.lesson_title && lower(m.title).includes(lower(m.lesson_title));
    name = [inTitle ? tiet : lesson, m.title].filter(Boolean).join(' - ');
  }
  return [...dirs, safeSeg(name, 'Tài liệu')].join('/');
}

/**
 * Học liệu khớp bộ lọc (đã áp quyền xem) kèm tệp phiên bản mới nhất.
 * Lấy dư một dòng để biết có vượt MAX_ZIP_ITEMS hay không.
 */
async function zipCandidates(req) {
  const me = req.user;
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const conds = listConditions(req.query, me, p);
  const vis = await materialVisibility(me, params.length + 1);
  const { where, params: visParams } = combine(conds.join(' and '), vis);
  const allParams = [...params, ...visParams];
  const limIdx = allParams.push(MAX_ZIP_ITEMS + 1);

  const items = await rows(
    `select m.id, m.title, m.grade, m.lesson_no, m.lesson_title, m.curriculum, m.subject,
            m.area, m.body, m.version_count, m.updated_at,
            ow.full_name as owner_name,
            mt.name as type_name,
            so.name as solution_name, sp.name as solution_parent_name,
            f.storage_path, f.size_bytes
       from materials m
       join users ow on ow.id = m.owner_id
       left join material_types mt on mt.id = m.type_id
       left join solutions so on so.id = m.solution_id
       left join solutions sp on sp.id = so.parent_id
       left join lateral (
         select v.file_id from material_versions v
          where v.material_id = m.id order by v.version desc limit 1
       ) lv on true
       left join files f on f.id = lv.file_id
      where ${where}
      order by coalesce(sp.sort_order, so.sort_order), coalesce(sp.name, so.name), so.name,
               m.grade nulls last, m.lesson_no nulls last, mt.sort_order nulls last, m.title
      limit $${limIdx}`,
    allParams
  );
  const tooMany = items.length > MAX_ZIP_ITEMS;
  return { items: tooMany ? items.slice(0, MAX_ZIP_ITEMS) : items, tooMany };
}

/** Nội dung tự do (bài viết không kèm tệp) ⇒ tệp .txt, có BOM để Notepad đọc đúng tiếng Việt. */
function bodyText(m) {
  const meta = [
    m.solution_name && `Giải pháp: ${[m.solution_parent_name, m.solution_name].filter(Boolean).join(' › ')}`,
    [m.grade && `Khối ${m.grade}`, m.lesson_no && `Tiết ${m.lesson_no}`, m.lesson_title].filter(Boolean).join(' · '),
    m.curriculum && `Chương trình: ${m.curriculum}`,
  ].filter(Boolean);
  return `\ufeff${m.title}\r\n${meta.join('\r\n')}\r\n${'-'.repeat(40)}\r\n\r\n${String(m.body).replace(/\r?\n/g, '\r\n')}\r\n`;
}

const todayVN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Xoá các tệp đã lỡ lưu khi nghiệp vụ thất bại giữa chừng (tránh tệp mồ côi trên đĩa). */
async function removeUploaded(files) {
  const all = Object.values(files || {}).flat();
  await Promise.all(all.map((f) => deleteFile(f.id).catch(() => {})));
}

/**
 * Điều kiện SQL hiển thị học liệu theo vai trò (§5.4).
 * school_id null = học liệu dùng chung, ai trong khu vực cũng thấy.
 * Trả { sql, params, next } theo quy ước lib/scope.js để nối vào combine().
 */
async function materialVisibility(user, next, alias = 'm') {
  if (user.role === 'admin') return { sql: 'true', params: [], next };

  const ids = await visibleSchoolIds(user);
  const params = [user.id];
  let inScope;
  if (ids.length) {
    inScope = `(${alias}.school_id is null or ${alias}.school_id = any($${next + 1}))`;
    params.push(ids);
  } else {
    inScope = `${alias}.school_id is null`;
  }

  // manager: mọi bài trong phạm vi (kể cả chưa duyệt); teacher/assistant: chỉ bài đã duyệt.
  const sql = user.role === 'manager'
    ? `(${alias}.area = 'official' or ${alias}.owner_id = $${next} or ${inScope})`
    : `(${alias}.area = 'official' or ${alias}.owner_id = $${next} or (${alias}.approval_status = 'approved' and ${inScope}))`;

  return { sql, params, next: next + params.length };
}

/** Lấy học liệu + kiểm tra quyền xem. Ngoài phạm vi ⇒ 404 (không lộ sự tồn tại). */
async function getMaterialForUser(user, id) {
  const m = await one(
    `select m.*, ow.full_name as owner_name, so.name as solution_name,
            mt.name as type_name, mt.icon as type_icon
       from materials m
       join users ow on ow.id = m.owner_id
       left join solutions so on so.id = m.solution_id
       left join material_types mt on mt.id = m.type_id
      where m.id = $1`,
    [id]
  );
  if (!m) throw notFound('Không tìm thấy học liệu.');
  if (user.role === 'admin' || m.area === 'official' || m.owner_id === user.id) return m;

  const ids = await visibleSchoolIds(user);
  const inScope = m.school_id === null || ids.includes(m.school_id);
  if (user.role === 'manager' && inScope) return m;
  if (m.approval_status === 'approved' && inScope) return m;
  throw notFound('Không tìm thấy học liệu.');
}

/** Chỉ chủ sở hữu hoặc admin/manager được sửa (manager đã qua kiểm phạm vi ở bước xem). */
function assertCanManage(user, m) {
  if (user.role === 'admin' || user.role === 'manager' || m.owner_id === user.id) return;
  throw forbidden('Chỉ chủ sở hữu hoặc Phòng chuyên môn/Quản trị viên được thao tác trên học liệu này.');
}

/** Giải pháp tham chiếu phải tồn tại và còn hiệu lực. */
async function checkSolution(solutionId) {
  const s = await one('select id from solutions where id = $1 and is_active', [solutionId]);
  if (!s) throw badRequest('Giải pháp được chọn không tồn tại hoặc đã bị vô hiệu.');
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/materials — danh sách, mọi vai trò (đã lọc hiển thị theo §5.4).
   * ?area=&level=&subject=&school_id=&class_id=&solution_id=&grade=&type_id=&type_ids=
   *  &q=&mine=1&page=&limit=  (solution_id gốc ⇒ gồm cả giải pháp con)
   * ---------------------------------------------------------------------- */
  app.get('/api/materials', async (req) => {
    const me = req.user;
    const { page, limit, offset } = paging(req.query);

    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const conds = listConditions(req.query, me, p);

    const vis = await materialVisibility(me, params.length + 1);
    const { where, params: visParams } = combine(conds.join(' and '), vis);
    const allParams = [...params, ...visParams];

    const total = await scalar(`select count(*)::int from materials m where ${where}`, allParams);

    const meIdx = allParams.push(me.id);
    const limIdx = allParams.push(limit);
    const offIdx = allParams.push(offset);

    const raw = await rows(
      `select m.*,
              ow.full_name as owner_name,
              so.name as solution_name,
              mt.name as type_name, mt.icon as type_icon,
              lv.id as lv_id, lv.version as lv_version, lv.file_id as lv_file_id,
              f.file_name as lv_file_name, f.size_bytes as lv_size_bytes,
              (select count(*)::int from material_comments mc where mc.material_id = m.id) as comment_count,
              (mr.material_id is null and m.created_at > now() - interval '30 days') as is_new
         from materials m
         join users ow on ow.id = m.owner_id
         left join solutions so on so.id = m.solution_id
         left join material_types mt on mt.id = m.type_id
         left join lateral (
           select v.id, v.version, v.file_id
             from material_versions v
            where v.material_id = m.id
            order by v.version desc
            limit 1
         ) lv on true
         left join files f on f.id = lv.file_id
         left join material_reads mr on mr.material_id = m.id and mr.user_id = $${meIdx}
        where ${where}
        order by m.created_at desc
        limit $${limIdx} offset $${offIdx}`,
      allParams
    );

    const items = raw.map(({ lv_id, lv_version, lv_file_id, lv_file_name, lv_size_bytes, ...rest }) => ({
      ...rest,
      latest_version: lv_id
        ? { id: lv_id, version: lv_version, file_id: lv_file_id, file_name: lv_file_name, size: lv_size_bytes }
        : null,
    }));
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/materials — multipart: tạo học liệu + phiên bản 1.
   * area='official' ⇒ material.official.write · area='teacher' ⇒ material.teacher.write
   * ---------------------------------------------------------------------- */
  app.post('/api/materials', async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('Cần gửi dữ liệu dạng multipart/form-data kèm tệp.');

    // Tệp học liệu mặc định không gắn trường (tài nguyên dùng chung); nếu có school_id
    // sẽ gắn lại bên dưới để quyền tải tệp khớp với phạm vi của học liệu.
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, schoolId: null, allowVideo: true });

    let material;
    let version;
    let file;
    let quiet = false;
    try {
      // Đăng hàng loạt: không báo từng tệp — client gọi /batch-done để báo một lần.
      quiet = bool(fields.batch, 'batch', { def: false });
      const area = enumOf(fields.area, 'area', AREAS, { required: true });
      assertPerm(req.user, area === 'official' ? 'material.official.write' : 'material.teacher.write');

      const level = enumOf(fields.level, 'level', LEVELS, { required: true });
      const title = str(fields.title, 'title', { required: true, max: 300 });
      const subject = str(fields.subject, 'subject', { max: 200 });
      const description = str(fields.description, 'description', { max: 5000 });
      const schoolId = uuid(fields.school_id, 'school_id');
      const classId = uuid(fields.class_id, 'class_id');
      const solutionId = uuid(fields.solution_id, 'solution_id');
      // Gắn bài giảng: khối 1-12 · loại tài liệu · tiết - tên bài - chương trình học.
      const grade = int(fields.grade, 'grade', { min: 1, max: 12 });
      const typeId = uuid(fields.type_id, 'type_id');
      const lessonNo = int(fields.lesson_no, 'lesson_no', { min: 1, max: 500 });
      const lessonTitle = str(fields.lesson_title, 'lesson_title', { max: 300 });
      const curriculum = str(fields.curriculum, 'curriculum', { max: 300 });
      const body = str(fields.body, 'body', { max: 50_000 });          // nội dung tự do
      if (schoolId) await assertSchoolAccess(req.user, schoolId);
      if (classId) await assertClassAccess(req.user, classId);
      if (solutionId) await checkSolution(solutionId);
      if (typeId) {
        const t = await one('select id from material_types where id = $1 and is_active', [typeId]);
        if (!t) throw badRequest('Loại tài liệu được chọn không tồn tại.');
      }

      file = files.file && files.file[0];
      const cover = files.cover && files.cover[0];   // ảnh minh hoạ (tuỳ chọn)
      // Có nội dung tự do thì tệp không bắt buộc — "đăng tài liệu, thêm nội dung bất kỳ".
      if (!file && !body) {
        throw badRequest('Cần đính kèm tệp học liệu (trường "file") hoặc nhập nội dung.');
      }

      // official: duyệt sẵn · teacher: chờ Phòng chuyên môn duyệt.
      const isOfficial = area === 'official';
      const res = await tx(async (c) => {
        const { rows: [m] } = await c.query(
          `insert into materials
             (level, area, title, subject, description, school_id, class_id, solution_id,
              owner_id, approval_status, approved_by, approved_at,
              grade, type_id, lesson_no, lesson_title, curriculum, body, cover_file_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           returning *`,
          [level, area, title, subject, description, schoolId, classId, solutionId,
           req.user.id, isOfficial ? 'approved' : 'pending',
           isOfficial ? req.user.id : null, isOfficial ? new Date() : null,
           grade, typeId, lessonNo, lessonTitle, curriculum, body, cover?.id ?? null]
        );
        let v = null;
        if (file) {
          ({ rows: [v] } = await c.query(
            `insert into material_versions (material_id, version, file_id, uploaded_by)
             values ($1, 1, $2, $3) returning *`,
            [m.id, file.id, req.user.id]
          ));
          await c.query('update materials set version_count = 1 where id = $1', [m.id]);
          m.version_count = 1;
        }
        if (schoolId) {
          for (const f of [file, cover].filter(Boolean)) {
            await c.query('update files set school_id = $1 where id = $2', [schoolId, f.id]);
          }
        }
        return { m, v };
      });
      material = res.m;
      version = res.v;
    } catch (e) {
      await removeUploaded(files);
      throw e;
    }

    // Học liệu chuẩn mới ⇒ báo cho GV/TG đang dạy cấp học tương ứng.
    if (material.area === 'official' && !quiet) {
      await notifyFieldStaff(
        {
          kind: 'material_new',
          title: `Học liệu mới: ${material.title}`,
          link: `/hoc-lieu/${material.id}`,
          refId: material.id,
        },
        { level: material.level }
      );
    }

    audit(req, {
      action: 'create', entity: 'materials', entityId: material.id,
      summary: `Đăng học liệu "${material.title}" (khu vực ${material.area})`, after: material,
    });

    return reply.code(201).send({
      ...material,
      latest_version: version && file
        ? { id: version.id, version: 1, file_id: file.id, file_name: file.file_name, size: file.size_bytes }
        : null,
    });
  });

  /* ------------------------------------------------------------------------
   * Loại tài liệu (giáo án / giáo trình / slide / … + mục tự thêm).
   * GET: mọi vai trò · POST: admin, manager (material.official.write).
   * ---------------------------------------------------------------------- */
  app.get('/api/materials/types', async () => {
    const items = await rows(
      'select id, name, icon, sort_order from material_types where is_active order by sort_order, name'
    );
    return { items };
  });

  app.post('/api/materials/types',
    { preHandler: requirePerm('material.official.write') },
    async (req, reply) => {
      const name = str(req.body?.name, 'name', { required: true, max: 100 });
      const icon = str(req.body?.icon, 'icon', { max: 8 }) || '📄';
      const dup = await one('select id from material_types where lower(name) = lower($1)', [name]);
      if (dup) throw conflict(`Loại tài liệu "${name}" đã tồn tại.`);
      const t = await one(
        `insert into material_types (name, icon, sort_order, created_by)
         values ($1, $2, (select coalesce(max(sort_order), 0) + 10 from material_types), $3)
         returning id, name, icon, sort_order`,
        [name, icon, req.user.id]
      );
      audit(req, {
        action: 'create', entity: 'material_types', entityId: t.id,
        summary: `Thêm loại tài liệu "${t.name}"`,
      });
      return reply.code(201).send(t);
    });

  /* ------------------------------------------------------------------------
   * POST /api/materials/batch-done — {ids}: kết thúc một lượt đăng hàng loạt.
   * Gửi MỘT thông báo tổng hợp theo cấp học thay vì mỗi tệp một thông báo.
   * Chỉ tính học liệu chuẩn do chính người gọi vừa đăng (trong 1 ngày).
   * ---------------------------------------------------------------------- */
  app.post('/api/materials/batch-done', async (req) => {
    const ids = uuidList(req.body?.ids, 'ids');
    if (ids.length > MAX_ZIP_ITEMS) throw badRequest(`Tối đa ${MAX_ZIP_ITEMS} tài liệu mỗi lượt.`);
    if (!ids.length) return { notified: 0 };

    const mats = await rows(
      `select m.id, m.title, m.level, so.name as solution_name
         from materials m
         left join solutions so on so.id = m.solution_id
        where m.id = any($1::uuid[]) and m.owner_id = $2 and m.area = 'official'
          and not m.is_archived and m.created_at > now() - interval '1 day'`,
      [ids, req.user.id]
    );

    const byLevel = new Map();
    for (const m of mats) {
      if (!byLevel.has(m.level)) byLevel.set(m.level, []);
      byLevel.get(m.level).push(m);
    }
    for (const [level, list] of byLevel) {
      const sols = [...new Set(list.map((x) => x.solution_name).filter(Boolean))];
      const one1 = list.length === 1 ? list[0] : null;
      await notifyFieldStaff(
        {
          kind: 'material_new',
          title: one1
            ? `Học liệu mới: ${one1.title}`
            : `${list.length} học liệu mới${sols.length ? ` — ${sols.slice(0, 2).join(', ')}${sols.length > 2 ? '…' : ''}` : ''}`,
          link: one1 ? `/hoc-lieu/${one1.id}` : '/hoc-lieu',
          refId: one1?.id,
        },
        { level }
      );
    }

    if (mats.length) {
      audit(req, {
        action: 'create', entity: 'materials',
        summary: `Đăng hàng loạt ${mats.length} học liệu chuẩn`,
        after: { ids: mats.map((m) => m.id) },
      });
    }
    return { notified: mats.length };
  });

  /* ------------------------------------------------------------------------
   * GET /api/materials/zip/preview — ước lượng trước khi tải ZIP.
   * Nhận cùng bộ lọc như danh sách + ids=a,b,c (mục đã chọn) + type_ids=.
   * ---------------------------------------------------------------------- */
  app.get('/api/materials/zip/preview', async (req) => {
    const { items, tooMany } = await zipCandidates(req);
    let fileCount = 0;
    let textCount = 0;
    let bytes = 0;
    for (const m of items) {
      if (m.storage_path) { fileCount++; bytes += Number(m.size_bytes || 0); } else if (m.body) textCount++;
    }
    return {
      count: items.length,
      file_count: fileCount,
      text_count: textCount,
      total_bytes: bytes,
      too_many: tooMany,
      too_large: bytes > MAX_ZIP_BYTES,
      max_items: MAX_ZIP_ITEMS,
      max_bytes: MAX_ZIP_BYTES,
    };
  });

  /* ------------------------------------------------------------------------
   * GET /api/materials/zip — tải về một tệp .zip theo cây thư mục.
   * ?group=type|lesson + bộ lọc như /zip/preview. Token qua ?token= được chấp nhận
   * để trình duyệt tự tải (có thanh tiến trình, không giữ cả tệp trong RAM).
   * ---------------------------------------------------------------------- */
  app.get('/api/materials/zip', async (req, reply) => {
    const group = enumOf(req.query.group, 'group', ['type', 'lesson'], { def: 'type' });
    const { items, tooMany } = await zipCandidates(req);
    if (!items.length) throw badRequest('Không có tài liệu nào khớp lựa chọn để tải về.');
    if (tooMany) {
      throw badRequest(`Mỗi lần tải tối đa ${MAX_ZIP_ITEMS} tài liệu — hãy thu hẹp theo khối hoặc loại tài liệu.`);
    }

    // Kiểm tệp trên đĩa TRƯỚC khi mở luồng ZIP: lỗi giữa chừng sẽ để lại tệp ZIP hỏng.
    const used = new Set();
    const uniq = (p, ext) => {
      let out = `${p}${ext}`;
      for (let i = 2; used.has(out.toLowerCase()); i++) out = `${p} (${i})${ext}`;
      used.add(out.toLowerCase());
      return out;
    };
    const entries = [];
    const manifest = [];
    let bytes = 0;
    for (const m of items) {
      const base = zipBasePath(m, group);
      let entryPath = '';
      let note = '';
      if (m.storage_path) {
        const abs = absPath(m);
        const st = await stat(abs).catch(() => null);
        if (st) {
          entryPath = uniq(base, path.extname(m.storage_path).toLowerCase());
          entries.push({ abs, path: entryPath, mtime: new Date(m.updated_at) });
          bytes += st.size;
        } else {
          note = 'Thiếu tệp trên máy chủ';
        }
      } else if (m.body) {
        entryPath = uniq(`${base} (bài viết)`, '.txt');
        entries.push({ text: bodyText(m), path: entryPath, mtime: new Date(m.updated_at) });
        note = 'Bài viết (không kèm tệp)';
      } else {
        note = 'Chưa có tệp';
      }
      manifest.push({
        stt: manifest.length + 1,
        path: entryPath || '—',
        solution: [m.solution_parent_name, m.solution_name].filter(Boolean).join(' › '),
        grade: m.grade || '',
        lesson_no: m.lesson_no || '',
        lesson_title: m.lesson_title || '',
        title: m.title,
        type: m.type_name || '',
        curriculum: m.curriculum || '',
        subject: m.subject || '',
        area: LABELS.area[m.area] || m.area,
        version: m.version_count || '',
        owner: m.owner_name || '',
        updated: formatVN(m.updated_at),
        note,
      });
    }
    if (!entries.length) throw badRequest('Các tài liệu đã chọn chưa có tệp nào để tải về.');
    if (bytes > MAX_ZIP_BYTES) {
      throw badRequest(`Dung lượng vượt ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)}MB — hãy tải theo từng khối hoặc từng loại tài liệu.`);
    }

    const solutionId = uuid(req.query.solution_id, 'solution_id');
    const sol = solutionId ? await one('select name from solutions where id = $1', [solutionId]) : null;
    const label = sol?.name || (req.query.ids ? 'Mục đã chọn' : 'Tổng hợp');

    const zip = new yazl.ZipFile();
    zip.addBuffer(await xlsxBuffer({
      sheetName: 'Danh mục',
      title: `Danh mục học liệu — ${label}`,
      subtitle: `${entries.length} tệp · sắp theo ${group === 'lesson' ? 'Bài học' : 'Loại tài liệu'}`,
      columns: [
        { header: 'STT', key: 'stt', width: 6, align: 'center' },
        { header: 'Tệp trong ZIP', key: 'path', width: 60 },
        { header: 'Giải pháp', key: 'solution', width: 22 },
        { header: 'Khối', key: 'grade', width: 7, align: 'center' },
        { header: 'Tiết', key: 'lesson_no', width: 7, align: 'center' },
        { header: 'Tên bài', key: 'lesson_title', width: 28 },
        { header: 'Tiêu đề', key: 'title', width: 34 },
        { header: 'Loại', key: 'type', width: 18 },
        { header: 'Chương trình', key: 'curriculum', width: 22 },
        { header: 'Môn', key: 'subject', width: 14 },
        { header: 'Khu vực', key: 'area', width: 16 },
        { header: 'Phiên bản', key: 'version', width: 9, align: 'center' },
        { header: 'Người đăng', key: 'owner', width: 20 },
        { header: 'Cập nhật', key: 'updated', width: 16 },
        { header: 'Ghi chú', key: 'note', width: 22 },
      ],
      rows: manifest,
    }), '00 - Danh muc hoc lieu.xlsx');
    for (const e of entries) {
      // Tài liệu văn phòng/PDF vốn đã nén — lưu nguyên để tải nhanh, đỡ tốn CPU máy chủ.
      if (e.abs) zip.addFile(e.abs, e.path, { compress: false, mtime: e.mtime });
      else zip.addBuffer(Buffer.from(e.text, 'utf8'), e.path, { mtime: e.mtime });
    }
    zip.end();

    audit(req, {
      action: 'export', entity: 'materials',
      summary: `Tải ZIP ${entries.length} học liệu (${label})`,
      after: { count: entries.length, bytes, group, query: { ...req.query, token: undefined } },
    });

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', contentDisposition('attachment', `Học liệu - ${label} - ${todayVN()}.zip`))
      .header('Cache-Control', 'no-store')
      .send(zip.outputStream);
  });

  /* ------------------------------------------------------------------------
   * GET /api/materials/:id — chi tiết kèm versions[] + comments[].
   * ---------------------------------------------------------------------- */
  app.get('/api/materials/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);

    const versions = await rows(
      `select v.id, v.version, v.file_id, v.change_note, v.created_at,
              f.file_name, f.size_bytes, f.mime,
              v.uploaded_by, u.full_name as uploaded_by_name
         from material_versions v
         join files f on f.id = v.file_id
         join users u on u.id = v.uploaded_by
        where v.material_id = $1
        order by v.version desc`,
      [id]
    );
    const comments = await rows(
      `select c.id, c.version_id, c.user_id, u.full_name as user_name, c.body, c.created_at
         from material_comments c
         join users u on u.id = c.user_id
        where c.material_id = $1
        order by c.created_at asc`,
      [id]
    );
    return { ...m, versions, comments };
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/materials/:id — chủ sở hữu hoặc admin/manager.
   * ---------------------------------------------------------------------- */
  app.patch('/api/materials/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);
    assertCanManage(req.user, m);

    const b = req.body || {};
    const updates = {};
    if (has(b, 'title')) updates.title = str(b.title, 'title', { required: true, max: 300 });
    if (has(b, 'subject')) updates.subject = str(b.subject, 'subject', { max: 200 });
    if (has(b, 'description')) updates.description = str(b.description, 'description', { max: 5000 });
    if (has(b, 'level')) updates.level = enumOf(b.level, 'level', LEVELS, { required: true });
    if (has(b, 'school_id')) {
      updates.school_id = uuid(b.school_id, 'school_id');
      if (updates.school_id) await assertSchoolAccess(req.user, updates.school_id);
    }
    if (has(b, 'class_id')) {
      updates.class_id = uuid(b.class_id, 'class_id');
      if (updates.class_id) await assertClassAccess(req.user, updates.class_id);
    }
    if (has(b, 'solution_id')) {
      updates.solution_id = uuid(b.solution_id, 'solution_id');
      if (updates.solution_id) await checkSolution(updates.solution_id);
    }
    if (has(b, 'is_archived')) updates.is_archived = bool(b.is_archived, 'is_archived', { required: true });
    // Trường gắn bài giảng (002): khối, loại, tiết - tên bài - chương trình, nội dung.
    if (has(b, 'grade')) updates.grade = int(b.grade, 'grade', { min: 1, max: 12 });
    if (has(b, 'type_id')) {
      updates.type_id = uuid(b.type_id, 'type_id');
      if (updates.type_id) {
        const t = await one('select id from material_types where id = $1 and is_active', [updates.type_id]);
        if (!t) throw badRequest('Loại tài liệu được chọn không tồn tại.');
      }
    }
    if (has(b, 'lesson_no')) updates.lesson_no = int(b.lesson_no, 'lesson_no', { min: 1, max: 500 });
    if (has(b, 'lesson_title')) updates.lesson_title = str(b.lesson_title, 'lesson_title', { max: 300 });
    if (has(b, 'curriculum')) updates.curriculum = str(b.curriculum, 'curriculum', { max: 300 });
    if (has(b, 'body')) updates.body = str(b.body, 'body', { max: 50_000 });

    const keys = Object.keys(updates);
    if (!keys.length) throw badRequest('Không có thông tin nào để cập nhật.');

    const params = [id];
    const sets = keys.map((k) => { params.push(updates[k]); return `${k} = $${params.length}`; });
    const updated = await one(`update materials set ${sets.join(', ')} where id = $1 returning *`, params);

    const before = {};
    for (const k of keys) before[k] = m[k];
    audit(req, {
      action: 'update', entity: 'materials', entityId: id,
      summary: `Sửa học liệu "${m.title}"`, before, after: updates,
    });
    return updated;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/materials/:id — xoá mềm (is_archived = true).
   * ---------------------------------------------------------------------- */
  app.delete('/api/materials/:id', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);
    assertCanManage(req.user, m);

    await query('update materials set is_archived = true where id = $1', [id]);
    audit(req, {
      action: 'delete', entity: 'materials', entityId: id,
      summary: `Gỡ học liệu "${m.title}" (lưu trữ mềm)`,
      before: { is_archived: m.is_archived }, after: { is_archived: true },
    });
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------------
   * POST /api/materials/:id/versions — multipart: tải phiên bản mới.
   * area='teacher' ⇒ quay về trạng thái chờ duyệt.
   * ---------------------------------------------------------------------- */
  app.post('/api/materials/:id/versions', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);
    assertCanManage(req.user, m);
    if (!req.isMultipart()) throw badRequest('Cần gửi dữ liệu dạng multipart/form-data kèm tệp.');

    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, schoolId: m.school_id, allowVideo: true });

    let version;
    let file;
    try {
      const changeNote = str(fields.change_note, 'change_note', { max: 2000 });
      file = files.file && files.file[0];
      if (!file) throw badRequest('Cần đính kèm đúng một tệp học liệu (trường "file").');

      version = await tx(async (c) => {
        // Tính số phiên bản ngay trong giao dịch để không đụng độ khi tải song song.
        const reset = m.area === 'teacher'
          ? `, approval_status = 'pending', approved_by = null, approved_at = null`
          : '';
        const { rows: [upd] } = await c.query(
          `update materials set version_count = version_count + 1${reset}
            where id = $1 returning version_count`,
          [id]
        );
        const { rows: [v] } = await c.query(
          `insert into material_versions (material_id, version, file_id, change_note, uploaded_by)
           values ($1,$2,$3,$4,$5) returning *`,
          [id, upd.version_count, file.id, changeNote, req.user.id]
        );
        return v;
      });
    } catch (e) {
      await removeUploaded(files);
      throw e;
    }

    if (m.area === 'official') {
      // Bản cập nhật học liệu chuẩn ⇒ báo GV/TG theo cấp học.
      await notifyFieldStaff(
        {
          kind: 'material_updated',
          title: `Học liệu cập nhật: ${m.title} (phiên bản ${version.version})`,
          link: `/hoc-lieu/${m.id}`,
          refId: m.id,
        },
        { level: m.level }
      );
    } else {
      // Bài của GV ⇒ nhắc Phòng chuyên môn duyệt lại.
      const n = {
        kind: 'material_pending',
        title: `Học liệu chờ duyệt: ${m.title} (phiên bản ${version.version})`,
        link: `/hoc-lieu/${m.id}`,
        refId: m.id,
      };
      if (m.school_id) {
        await notifySchoolManagers(m.school_id, n);
      } else {
        const mgrs = await rows(`select id from users where is_active and role in ('admin','manager')`);
        await notify(mgrs.map((x) => x.id), n);
      }
    }

    audit(req, {
      action: 'update', entity: 'materials', entityId: id,
      summary: `Tải phiên bản ${version.version} cho học liệu "${m.title}"`, after: version,
    });
    return reply.code(201).send({ ...version, file_name: file.file_name, size_bytes: file.size_bytes });
  });

  /* ------------------------------------------------------------------------
   * POST /api/materials/:id/approve — admin/manager duyệt hoặc từ chối.
   * ---------------------------------------------------------------------- */
  app.post('/api/materials/:id/approve', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);
    assertPerm(req.user, 'material.approve');

    const b = req.body || {};
    const decision = enumOf(b.decision, 'decision', ['approved', 'rejected'], { required: true });
    const note = str(b.note, 'note', { max: 2000 });

    const updated = await one(
      `update materials set approval_status = $2, approved_by = $3, approved_at = now()
        where id = $1 returning *`,
      [id, decision, req.user.id]
    );

    // Báo cho chủ sở hữu (trừ khi tự duyệt bài của mình).
    if (m.owner_id !== req.user.id) {
      await notify(m.owner_id, {
        kind: 'material_reviewed',
        title: decision === 'approved'
          ? `Học liệu "${m.title}" đã được duyệt`
          : `Học liệu "${m.title}" bị từ chối`,
        body: note,
        link: `/hoc-lieu/${id}`,
        refId: id,
      });
    }

    audit(req, {
      action: decision === 'approved' ? 'approve' : 'reject', entity: 'materials', entityId: id,
      summary: `${decision === 'approved' ? 'Duyệt' : 'Từ chối'} học liệu "${m.title}"${note ? ` — ${note}` : ''}`,
      before: { approval_status: m.approval_status }, after: { approval_status: decision },
    });
    return updated;
  });

  /* ------------------------------------------------------------------------
   * GET /api/materials/:id/comments — ai xem được bài thì xem được bình luận.
   * ---------------------------------------------------------------------- */
  app.get('/api/materials/:id/comments', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    await getMaterialForUser(req.user, id);

    const { page, limit, offset } = paging(req.query);
    const total = await scalar('select count(*)::int from material_comments where material_id = $1', [id]);
    const items = await rows(
      `select c.id, c.version_id, c.user_id, u.full_name as user_name, c.body, c.created_at
         from material_comments c
         join users u on u.id = c.user_id
        where c.material_id = $1
        order by c.created_at asc
        limit $2 offset $3`,
      [id, limit, offset]
    );
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/materials/:id/comments — {body, version_id?}.
   * ---------------------------------------------------------------------- */
  app.post('/api/materials/:id/comments', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const m = await getMaterialForUser(req.user, id);

    const b = req.body || {};
    const body = str(b.body, 'body', { required: true, max: 5000 });
    const versionId = uuid(b.version_id, 'version_id');
    if (versionId) {
      const v = await one('select id from material_versions where id = $1 and material_id = $2', [versionId, id]);
      if (!v) throw badRequest('Phiên bản được góp ý không thuộc học liệu này.');
    }

    const c = await one(
      `insert into material_comments (material_id, version_id, user_id, body)
       values ($1,$2,$3,$4) returning *`,
      [id, versionId, req.user.id, body]
    );

    // Báo cho chủ sở hữu nếu người bình luận không phải chính chủ.
    if (m.owner_id !== req.user.id) {
      await notify(m.owner_id, {
        kind: 'material_comment',
        title: `Bình luận mới ở học liệu "${m.title}"`,
        body: body.length > 200 ? `${body.slice(0, 200)}…` : body,
        link: `/hoc-lieu/${id}`,
        refId: id,
      });
    }
    return reply.code(201).send({ ...c, user_name: req.user.full_name });
  });

  /* ------------------------------------------------------------------------
   * POST /api/materials/:id/read — đánh dấu đã đọc (phục vụ badge "mới").
   * ---------------------------------------------------------------------- */
  app.post('/api/materials/:id/read', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    await getMaterialForUser(req.user, id);

    await query(
      `insert into material_reads (material_id, user_id) values ($1, $2)
       on conflict (material_id, user_id) do update set read_at = now()`,
      [id, req.user.id]
    );
    return reply.code(204).send();
  });
}
