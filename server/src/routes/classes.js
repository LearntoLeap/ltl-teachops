/**
 * routes/classes.js — Lớp học & phân công giáo viên/trợ giảng phụ trách lớp.
 * Hợp đồng: docs/API.md mục 3 · Phạm vi dữ liệu: docs/ARCHITECTURE.md §3.
 */
import { rows, one, scalar, tx } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import { schoolFilter, combine, assertSchoolAccess, assertClassAccess } from '../lib/scope.js';
import { audit } from '../lib/audit.js';
import { conflict, badRequest, unprocessable } from '../lib/errors.js';
import { str, int, bool, uuid, enumOf, paging } from '../lib/validate.js';
import { sendXlsx } from '../lib/xlsx.js';

// Khớp enum edu_level trong 001_init.sql
const LEVELS = ['primary', 'secondary', 'highschool'];
const MAX_BATCH_ROWS = 300;

/** Khối 1-5 → Tiểu học · 6-9 → THCS · 10-12 → THPT. */
const levelOfGrade = (g) => (g <= 5 ? 'primary' : g <= 9 ? 'secondary' : 'highschool');

/** Cấp học: lấy theo giá trị gửi lên, không có thì suy từ khối. */
function resolveLevel(b, grade) {
  const level = enumOf(b.level, 'Cấp học', LEVELS) || (grade ? levelOfGrade(grade) : null);
  if (!level) throw badRequest('Cần nhập Khối (1–12) hoặc chọn Cấp học.');
  return level;
}

async function assertStaff(userId, role, label) {
  const u = await one('select id, full_name, role, is_active from users where id = $1', [userId]);
  if (!u || u.role !== role || !u.is_active) {
    throw unprocessable(`${label} không hợp lệ — phải là tài khoản ${label.toLowerCase()} đang hoạt động.`);
  }
  return u;
}

/** Subquery: danh sách người phụ trách lớp (từ class_assignments, kèm vai trò trong lớp). */
const TEACHERS_SQL = `
  coalesce((
    select json_agg(json_build_object(
             'user_id', u.id, 'full_name', u.full_name, 'email', u.email,
             'phone', u.phone, 'role', ca.role)
           order by ca.role, u.full_name)
      from class_assignments ca
      join users u on u.id = ca.user_id
     where ca.class_id = c.id
  ), '[]'::json) as teachers`;

/**
 * Mệnh đề phạm vi cho bảng classes (bí danh c):
 * admin tất cả · manager theo trường phụ trách ·
 * teacher/assistant chỉ lớp được phân công hoặc lớp có buổi dạy của mình.
 */
async function classScope(user, next) {
  if (user.role === 'admin') return { sql: 'true', params: [], next };
  if (user.role === 'manager') return schoolFilter(user, 'c.school_id', next);
  return {
    sql: `(exists (select 1 from class_assignments ca2
                    where ca2.class_id = c.id and ca2.user_id = $${next})
           or exists (select 1 from schedules sch
                       where sch.class_id = c.id
                         and (sch.teacher_id = $${next} or sch.assistant_id = $${next})))`,
    params: [user.id],
    next: next + 1,
  };
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/classes — ?school_id=&level=&q=&is_active= + phân trang.
   * Kèm school_name và teachers[] (người phụ trách + vai trò).
   * ---------------------------------------------------------------------- */
  app.get('/api/classes', async (req) => {
    const schoolId = uuid(req.query.school_id, 'school_id');
    const level = enumOf(req.query.level, 'level', LEVELS);
    const q = str(req.query.q, 'q', { max: 100 });
    const isActive = bool(req.query.is_active, 'is_active');
    const { page, limit, offset } = paging(req.query);

    let next = 1;
    const filters = [];
    const scope = await classScope(req.user, next);
    next = scope.next;
    filters.push(scope);
    if (schoolId) {
      filters.push({ sql: `c.school_id = $${next}`, params: [schoolId] });
      next += 1;
    }
    if (level) {
      filters.push({ sql: `c.level = $${next}`, params: [level] });
      next += 1;
    }
    if (q !== null) {
      filters.push({ sql: `c.name ilike $${next}`, params: [`%${q}%`] });
      next += 1;
    }
    if (isActive !== null) {
      filters.push({ sql: `c.is_active = $${next}`, params: [isActive] });
      next += 1;
    }
    const { where, params } = combine(null, ...filters);

    const total = await scalar(`select count(*) from classes c where ${where}`, params);
    const items = await rows(
      `select c.*, s.name as school_name, ${TEACHERS_SQL}
         from classes c
         join schools s on s.id = c.school_id
        where ${where}
        order by s.name, c.name
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/classes — admin, manager (org.manage) trong phạm vi trường.
   * ---------------------------------------------------------------------- */
  app.post('/api/classes', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = req.body || {};
    const schoolId = uuid(b.school_id, 'school_id', { required: true });
    const name = str(b.name, 'Tên lớp', { required: true, max: 100 });
    const grade = int(b.grade, 'Khối', { min: 1, max: 12 });
    const level = resolveLevel(b, grade);
    const rosterSize = int(b.roster_size, 'roster_size', { min: 0, max: 200, def: 0 });
    const note = str(b.note, 'note', { max: 1000 });

    await assertSchoolAccess(req.user, schoolId); // ngoài phạm vi ⇒ 404

    const dup = await one('select id from classes where school_id = $1 and name = $2', [schoolId, name]);
    if (dup) throw conflict(`Lớp "${name}" đã tồn tại trong trường này.`);

    const cls = await one(
      `insert into classes (school_id, name, level, grade, roster_size, note)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [schoolId, name, level, grade, rosterSize, note]
    );
    audit(req, {
      action: 'create',
      entity: 'classes',
      entityId: cls.id,
      summary: `Tạo lớp ${cls.name}`,
      after: cls,
    });
    return reply.code(201).send(cls);
  });

  /* ------------------------------------------------------------------------
   * POST /api/classes/batch — nhập NHIỀU lớp một lượt (dạng bảng / dán Excel),
   * mỗi dòng có thể thuộc một trường khác nhau và gán sẵn GV/TG phụ trách.
   * body: { rows: [{ school_id, name, grade?, level?, roster_size?, note?,
   *                  teacher_id?, assistant_id? }] }
   * Dòng lỗi bị bỏ qua và trả về trong `skipped` kèm số dòng + lý do.
   * ---------------------------------------------------------------------- */
  app.post('/api/classes/batch', { preHandler: requirePerm('org.manage') }, async (req) => {
    const rowsIn = req.body?.rows;
    if (!Array.isArray(rowsIn) || !rowsIn.length) throw badRequest('Chưa có dòng nào để tạo.');
    if (rowsIn.length > MAX_BATCH_ROWS) {
      throw badRequest(`Mỗi lượt nhập tối đa ${MAX_BATCH_ROWS} dòng (đang có ${rowsIn.length}).`);
    }

    const schools = new Map();   // school_id → trường đã qua kiểm phạm vi
    const created = [];
    const skipped = [];
    for (let i = 0; i < rowsIn.length; i++) {
      const b = rowsIn[i] || {};
      try {
        const schoolId = uuid(b.school_id, 'Trường', { required: true });
        if (!schools.has(schoolId)) schools.set(schoolId, await assertSchoolAccess(req.user, schoolId));
        const school = schools.get(schoolId);

        const name = str(b.name, 'Tên lớp', { required: true, max: 100 });
        const grade = int(b.grade, 'Khối', { min: 1, max: 12 });
        const level = resolveLevel(b, grade);
        const rosterSize = int(b.roster_size, 'Sĩ số', { min: 0, max: 200, def: 0 });
        const note = str(b.note, 'Ghi chú', { max: 1000 });
        const teacherId = uuid(b.teacher_id, 'Giáo viên');
        const assistantId = uuid(b.assistant_id, 'Trợ giảng');
        if (teacherId) await assertStaff(teacherId, 'teacher', 'Giáo viên');
        if (assistantId) await assertStaff(assistantId, 'assistant', 'Trợ giảng');

        const dup = await one('select is_active from classes where school_id = $1 and name = $2', [schoolId, name]);
        if (dup) {
          throw conflict(`Lớp "${name}" đã có ở ${school.name}${dup.is_active ? '' : ' (đang bị vô hiệu hoá)'}.`);
        }

        const cls = await tx(async (c) => {
          const { rows: [x] } = await c.query(
            `insert into classes (school_id, name, level, grade, roster_size, note)
             values ($1, $2, $3, $4, $5, $6) returning *`,
            [schoolId, name, level, grade, rosterSize, note]
          );
          for (const [uid, role] of [[teacherId, 'teacher'], [assistantId, 'assistant']]) {
            if (!uid) continue;
            await c.query(
              'insert into class_assignments (class_id, user_id, role) values ($1, $2, $3)',
              [x.id, uid, role]
            );
          }
          return x;
        });
        created.push({ id: cls.id, name: cls.name, school_name: school.name });
      } catch (e) {
        skipped.push({ row: i + 1, reason: e.message || 'Dòng không hợp lệ.' });
      }
    }

    if (created.length) {
      audit(req, {
        action: 'create', entity: 'classes',
        summary: `Nhập bảng lớp: tạo ${created.length} lớp` +
          `${skipped.length ? `, bỏ qua ${skipped.length} dòng` : ''}.`,
        after: { created, skipped },
      });
    }
    return { created: created.length, items: created, skipped };
  });

  /* GET /api/classes/batch-template — tệp Excel mẫu đúng thứ tự cột của bảng nhập lớp. */
  app.get('/api/classes/batch-template', { preHandler: requirePerm('org.manage') }, async (req, reply) =>
    sendXlsx(reply, {
      fileName: 'mau-nhap-lop',
      sheetName: 'Nhập lớp',
      title: 'MẪU NHẬP DANH SÁCH LỚP — LtL TeachOps',
      subtitle: 'Điền từ dòng 5 (xoá 2 dòng ví dụ) → bôi đen các dòng dữ liệu → Copy → bấm Ctrl+V trên bảng "Nhập bảng lớp". Cột Trường ghi MÃ hoặc TÊN trường; để trống = trường đang chọn.',
      columns: [
        { header: 'Mã / Tên trường', key: 'school', width: 22 },
        { header: 'Tên lớp *', key: 'name', width: 12 },
        { header: 'Khối (1-12)', key: 'grade', width: 10, align: 'center' },
        { header: 'Cấp học (TH / THCS / THPT)', key: 'level', width: 16 },
        { header: 'Sĩ số', key: 'roster', width: 8, align: 'center' },
        { header: 'Giáo viên phụ trách', key: 'teacher', width: 24 },
        { header: 'Trợ giảng phụ trách', key: 'assistant', width: 24 },
        { header: 'Ghi chú', key: 'note', width: 28 },
      ],
      rows: [
        { school: 'VD-THCS01', name: '6A1', grade: 6, level: 'THCS', roster: 38, teacher: 'Nguyễn Văn A', assistant: 'Trần Thị B', note: 'Ví dụ — xoá dòng này' },
        { school: 'VD-THCS01', name: '6A2', grade: 6, level: '', roster: 40, teacher: '', assistant: '', note: '' },
      ],
    }));

  /* ------------------------------------------------------------------------
   * GET /api/classes/:id — chi tiết lớp + school_name + teachers[].
   * ---------------------------------------------------------------------- */
  app.get('/api/classes/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    await assertClassAccess(req.user, id); // ngoài phạm vi ⇒ 404
    return one(
      `select c.*, s.name as school_name, ${TEACHERS_SQL}
         from classes c
         join schools s on s.id = c.school_id
        where c.id = $1`,
      [id]
    );
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/classes/:id — org.manage.
   * ---------------------------------------------------------------------- */
  app.patch('/api/classes/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertClassAccess(req.user, id);

    const b = req.body || {};
    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if ('name' in b) {
      const name = str(b.name, 'name', { required: true, max: 100 });
      if (name !== before.name) {
        const dup = await one(
          'select id from classes where school_id = $1 and name = $2 and id <> $3',
          [before.school_id, name, id]
        );
        if (dup) throw conflict(`Lớp "${name}" đã tồn tại trong trường này.`);
      }
      set('name', name);
    }
    if ('level' in b) set('level', enumOf(b.level, 'level', LEVELS, { required: true }));
    if ('grade' in b) set('grade', int(b.grade, 'grade', { min: 1, max: 12 }));
    if ('roster_size' in b) {
      set('roster_size', int(b.roster_size, 'roster_size', { required: true, min: 0, max: 200 }));
    }
    if ('note' in b) set('note', str(b.note, 'note', { max: 1000 }));

    if (!sets.length) throw badRequest('Không có thông tin nào để cập nhật.');

    params.push(id);
    const after = await one(
      `update classes set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    audit(req, {
      action: 'update',
      entity: 'classes',
      entityId: id,
      summary: `Cập nhật lớp ${after.name}`,
      before,
      after,
    });
    return after;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/classes/:id — org.manage. Soft delete: is_active = false.
   * ---------------------------------------------------------------------- */
  app.delete('/api/classes/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertClassAccess(req.user, id);
    const after = await one('update classes set is_active = false where id = $1 returning *', [id]);
    audit(req, {
      action: 'delete',
      entity: 'classes',
      entityId: id,
      summary: `Vô hiệu hoá lớp ${before.name}`,
      before,
      after,
    });
    return { ok: true };
  });

  /* ------------------------------------------------------------------------
   * PUT /api/classes/:id/assignments — org.manage.
   * Body: { assignments: [{ user_id, role: 'teacher'|'assistant' }] }
   * Thay TOÀN BỘ phân công của lớp (xoá hết chèn lại trong một giao dịch).
   * ---------------------------------------------------------------------- */
  app.put('/api/classes/:id/assignments', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const cls = await assertClassAccess(req.user, id);

    const b = req.body || {};
    if (!Array.isArray(b.assignments)) {
      throw badRequest('Thiếu danh sách assignments (mảng {user_id, role}).');
    }

    // Ép kiểu + khử trùng lặp (khoá chính class_assignments là class_id + user_id + role)
    const seen = new Set();
    const wanted = [];
    for (let i = 0; i < b.assignments.length; i++) {
      const a = b.assignments[i] || {};
      const userId = uuid(a.user_id, `assignments[${i}].user_id`, { required: true });
      const role = enumOf(a.role, `assignments[${i}].role`, ['teacher', 'assistant'], { required: true });
      const key = `${userId}:${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push({ userId, role });
    }

    // Vai trò tài khoản phải khớp vai trò được gán: teacher↔teacher, assistant↔assistant.
    // Admin/manager không đứng lớp ⇒ không gán được.
    if (wanted.length) {
      const users = await rows(
        'select id, full_name, role, is_active from users where id = any($1)',
        [wanted.map((w) => w.userId)]
      );
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const w of wanted) {
        const u = byId.get(w.userId);
        if (!u) throw unprocessable('Có người dùng trong danh sách phân công không tồn tại.');
        if (!u.is_active) {
          throw unprocessable(`Tài khoản "${u.full_name}" đã bị vô hiệu hoá, không thể phân công.`);
        }
        if (u.role !== w.role) {
          throw unprocessable(
            `Không gán được "${u.full_name}": vai trò tài khoản phải khớp vị trí phân công ` +
            '(Giáo viên vào vị trí giáo viên, Trợ giảng vào vị trí trợ giảng; ' +
            'Quản trị viên/Phòng chuyên môn không đứng lớp).'
          );
        }
      }
    }

    const before = await rows(
      `select ca.user_id, ca.role, u.full_name
         from class_assignments ca join users u on u.id = ca.user_id
        where ca.class_id = $1
        order by ca.role, u.full_name`,
      [id]
    );

    await tx(async (c) => {
      await c.query('delete from class_assignments where class_id = $1', [id]);
      if (wanted.length) {
        await c.query(
          `insert into class_assignments (class_id, user_id, role)
           select $1, t.uid, t.r::class_role
             from unnest($2::uuid[], $3::text[]) as t(uid, r)`,
          [id, wanted.map((w) => w.userId), wanted.map((w) => w.role)]
        );
      }
    });

    const after = await rows(
      `select ca.user_id, ca.role, u.full_name, u.email, u.phone
         from class_assignments ca join users u on u.id = ca.user_id
        where ca.class_id = $1
        order by ca.role, u.full_name`,
      [id]
    );

    audit(req, {
      action: 'update',
      entity: 'class_assignments',
      entityId: id,
      summary: `Phân công lớp ${cls.name}: ${after.length} người phụ trách`,
      before: { assignments: before },
      after: { assignments: after },
    });
    return { class_id: id, assignments: after };
  });
}
