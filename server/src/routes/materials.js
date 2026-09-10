/**
 * materials.js — Học liệu (giáo án / giáo trình / slide) — docs/API.md §8, ARCHITECTURE.md §5.4.
 *
 * Hai khu vực:
 *   - official: kho chuẩn — chỉ admin/manager tải lên, mọi người đã đăng nhập đều xem.
 *   - teacher : bài của giáo viên/trợ giảng — thấy bài của MÌNH + bài đã duyệt trong
 *               phạm vi trường; manager thấy mọi bài trong phạm vi; admin thấy tất.
 * Mỗi lần tải tệp tạo một material_versions mới — giữ trọn lịch sử phiên bản.
 */
import { rows, one, scalar, tx, query } from '../db.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { assertPerm } from '../lib/rbac.js';
import { visibleSchoolIds, combine, assertSchoolAccess, assertClassAccess } from '../lib/scope.js';
import { str, uuid, bool, enumOf, paging } from '../lib/validate.js';
import { consumeMultipart, deleteFile } from '../lib/storage.js';
import { notify, notifySchoolManagers, notifyFieldStaff } from '../lib/notify.js';
import { audit } from '../lib/audit.js';

const LEVELS = ['primary', 'secondary', 'highschool'];
const AREAS = ['official', 'teacher'];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

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
    `select m.*, ow.full_name as owner_name, so.name as solution_name
       from materials m
       join users ow on ow.id = m.owner_id
       left join solutions so on so.id = m.solution_id
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
   * ?area=&level=&subject=&school_id=&class_id=&solution_id=&q=&mine=1&page=&limit=
   * ---------------------------------------------------------------------- */
  app.get('/api/materials', async (req) => {
    const me = req.user;
    const { page, limit, offset } = paging(req.query);

    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const conds = ['not m.is_archived'];

    const area = enumOf(req.query.area, 'area', AREAS);
    if (area) conds.push(`m.area = ${p(area)}`);
    const level = enumOf(req.query.level, 'level', LEVELS);
    if (level) conds.push(`m.level = ${p(level)}`);
    const subject = str(req.query.subject, 'subject', { max: 200 });
    if (subject) conds.push(`m.subject ilike ${p(subject)}`); // so khớp không phân biệt hoa thường
    const schoolId = uuid(req.query.school_id, 'school_id');
    if (schoolId) conds.push(`m.school_id = ${p(schoolId)}`);
    const classId = uuid(req.query.class_id, 'class_id');
    if (classId) conds.push(`m.class_id = ${p(classId)}`);
    const solutionId = uuid(req.query.solution_id, 'solution_id');
    if (solutionId) conds.push(`m.solution_id = ${p(solutionId)}`);
    const search = str(req.query.q, 'q', { max: 200 });
    if (search) {
      const like = p(`%${search}%`);
      conds.push(`(m.title ilike ${like} or m.description ilike ${like})`);
    }
    if (bool(req.query.mine, 'mine', { def: false })) conds.push(`m.owner_id = ${p(me.id)}`);

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
              lv.id as lv_id, lv.version as lv_version, lv.file_id as lv_file_id,
              f.file_name as lv_file_name, f.size_bytes as lv_size_bytes,
              (select count(*)::int from material_comments mc where mc.material_id = m.id) as comment_count,
              (mr.material_id is null and m.created_at > now() - interval '30 days') as is_new
         from materials m
         join users ow on ow.id = m.owner_id
         left join solutions so on so.id = m.solution_id
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
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, schoolId: null });

    let material;
    let version;
    let file;
    try {
      const area = enumOf(fields.area, 'area', AREAS, { required: true });
      assertPerm(req.user, area === 'official' ? 'material.official.write' : 'material.teacher.write');

      const level = enumOf(fields.level, 'level', LEVELS, { required: true });
      const title = str(fields.title, 'title', { required: true, max: 300 });
      const subject = str(fields.subject, 'subject', { max: 200 });
      const description = str(fields.description, 'description', { max: 5000 });
      const schoolId = uuid(fields.school_id, 'school_id');
      const classId = uuid(fields.class_id, 'class_id');
      const solutionId = uuid(fields.solution_id, 'solution_id');
      if (schoolId) await assertSchoolAccess(req.user, schoolId);
      if (classId) await assertClassAccess(req.user, classId);
      if (solutionId) await checkSolution(solutionId);

      file = files.file && files.file[0];
      if (!file) throw badRequest('Cần đính kèm đúng một tệp học liệu (trường "file").');

      // official: duyệt sẵn · teacher: chờ Phòng chuyên môn duyệt.
      const isOfficial = area === 'official';
      const res = await tx(async (c) => {
        const { rows: [m] } = await c.query(
          `insert into materials
             (level, area, title, subject, description, school_id, class_id, solution_id,
              owner_id, approval_status, approved_by, approved_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           returning *`,
          [level, area, title, subject, description, schoolId, classId, solutionId,
           req.user.id, isOfficial ? 'approved' : 'pending',
           isOfficial ? req.user.id : null, isOfficial ? new Date() : null]
        );
        const { rows: [v] } = await c.query(
          `insert into material_versions (material_id, version, file_id, uploaded_by)
           values ($1, 1, $2, $3) returning *`,
          [m.id, file.id, req.user.id]
        );
        await c.query('update materials set version_count = 1 where id = $1', [m.id]);
        if (schoolId) await c.query('update files set school_id = $1 where id = $2', [schoolId, file.id]);
        m.version_count = 1;
        return { m, v };
      });
      material = res.m;
      version = res.v;
    } catch (e) {
      await removeUploaded(files);
      throw e;
    }

    // Học liệu chuẩn mới ⇒ báo cho GV/TG đang dạy cấp học tương ứng.
    if (material.area === 'official') {
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
      latest_version: {
        id: version.id, version: 1, file_id: file.id, file_name: file.file_name, size: file.size_bytes,
      },
    });
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

    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, schoolId: m.school_id });

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
