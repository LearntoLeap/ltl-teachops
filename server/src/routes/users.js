/**
 * routes/users.js — Quản lý tài khoản người dùng (mục 2 docs/API.md).
 *
 * Phạm vi: admin thấy tất cả; manager chỉ thấy teacher/assistant/manager
 * gắn với các trường trong phạm vi của mình (user_schools / class_assignments / schedules).
 * Bản ghi ngoài phạm vi ⇒ 404 (không lộ sự tồn tại).
 */
import { query, rows, one, scalar, tx } from '../db.js';
import { notFound, conflict, unprocessable, badRequest } from '../lib/errors.js';
import { requirePerm, assertPerm, ROLES, ROLE_LABEL, isAdmin } from '../lib/rbac.js';
import { visibleSchoolIds, assertSchoolAccess, scheduleFilter } from '../lib/scope.js';
import { generateTempPassword, hashPassword, revokeAllUserTokens } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { sendWelcome } from '../lib/mailer.js';
import {
  str, uuid, bool, enumOf, email, uuidList, paging, dateRange,
} from '../lib/validate.js';

/** Cột công khai của bảng users — KHÔNG BAO GIỜ trả password_hash. */
const USER_COLS = `u.id, u.email, u.full_name, u.phone, u.role, u.is_active,
       u.must_change_password, u.avatar_file_id, u.last_login_at,
       u.created_by, u.created_at, u.updated_at`;

/**
 * Điều kiện SQL: người dùng (bí danh u) có gắn với ít nhất một trường trong mảng $idx (uuid[])
 * qua một trong ba đường: phạm vi manager, lớp phụ trách, buổi được phân công.
 */
const userSchoolLinkSql = (idx) => `exists (
  select 1 from user_schools _us
   where _us.user_id = u.id and _us.school_id = any($${idx})
  union all
  select 1 from class_assignments _ca join classes _c on _c.id = _ca.class_id
   where _ca.user_id = u.id and _c.school_id = any($${idx})
  union all
  select 1 from schedules _s
   where (_s.teacher_id = u.id or _s.assistant_id = u.id) and _s.school_id = any($${idx})
)`;

/**
 * Lấy một người dùng sau khi kiểm phạm vi.
 * admin: mọi người. manager: chỉ manager/teacher/assistant gắn với trường trong phạm vi.
 * Ngoài phạm vi ⇒ notFound (404).
 */
async function getVisibleUser(actor, id) {
  const u = await one(`select ${USER_COLS} from users u where u.id = $1`, [id]);
  if (!u) throw notFound('Không tìm thấy người dùng.');
  if (isAdmin(actor)) return u;
  if (u.id === actor.id) return u;
  if (!['manager', 'teacher', 'assistant'].includes(u.role)) {
    throw notFound('Không tìm thấy người dùng.');
  }
  const ids = await visibleSchoolIds(actor);
  if (!ids || !ids.length) throw notFound('Không tìm thấy người dùng.');
  const linked = await one(
    `select 1 from users u where u.id = $1 and ${userSchoolLinkSql(2)}`,
    [id, ids]
  );
  if (!linked) throw notFound('Không tìm thấy người dùng.');
  return u;
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/users — danh sách (admin, manager)
   * ---------------------------------------------------------------------- */
  app.get('/api/users', { preHandler: requirePerm('users.view') }, async (req) => {
    const q = req.query || {};
    const role = enumOf(q.role, 'role', ROLES);
    const schoolId = uuid(q.school_id, 'school_id');
    const search = str(q.q, 'q', { max: 200 });
    const isActive = bool(q.is_active, 'is_active');
    const { page, limit, offset } = paging(q);

    const conds = ['true'];
    const params = [];
    let next = 1;

    // Phạm vi: manager chỉ thấy manager/teacher/assistant thuộc trường mình phụ trách
    if (!isAdmin(req.user)) {
      const ids = await visibleSchoolIds(req.user);
      if (!ids || !ids.length) return { items: [], total: 0, page, limit };
      conds.push(`u.role in ('manager', 'teacher', 'assistant')`);
      conds.push(userSchoolLinkSql(next));
      params.push(ids);
      next += 1;
    }

    // Lọc theo trường: kiểm tồn tại + phạm vi trước (ngoài phạm vi ⇒ 404)
    if (schoolId) {
      await assertSchoolAccess(req.user, schoolId);
      conds.push(userSchoolLinkSql(next));
      params.push([schoolId]);
      next += 1;
    }

    if (role) {
      conds.push(`u.role = $${next}`);
      params.push(role);
      next += 1;
    }
    if (search) {
      conds.push(`(u.full_name ilike $${next} or u.email ilike $${next})`);
      params.push(`%${search}%`);
      next += 1;
    }
    if (isActive !== null) {
      conds.push(`u.is_active = $${next}`);
      params.push(isActive);
      next += 1;
    }

    const where = conds.join(' and ');
    const total = await scalar(`select count(*) from users u where ${where}`, params);

    // school_names: tên các trường trong phạm vi user_schools (dành cho tài khoản manager)
    const items = await rows(
      `select ${USER_COLS}, coalesce(sn.names, array[]::text[]) as school_names
         from users u
         left join lateral (
           select array_agg(s.name order by s.name) as names
             from user_schools us join schools s on s.id = us.school_id
            where us.user_id = u.id
         ) sn on true
        where ${where}
        order by u.full_name asc, u.created_at desc
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );

    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/users — tạo tài khoản + mật khẩu tạm + email (admin)
   * ---------------------------------------------------------------------- */
  app.post('/api/users', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const b = req.body || {};
    const emailAddr = email(b.email, 'Email', { required: true });
    const fullName = str(b.full_name, 'Họ và tên', { required: true, max: 200 });
    const phone = str(b.phone, 'Số điện thoại', { max: 30 });
    const role = enumOf(b.role, 'Vai trò', ROLES, { required: true });
    const schoolIds = [...new Set(uuidList(b.school_ids, 'school_ids'))];

    const existed = await one('select id from users where email = $1', [emailAddr]);
    if (existed) throw conflict('Email này đã có tài khoản.');

    // Phạm vi trường chỉ áp dụng cho manager — kiểm tồn tại trước khi chèn
    if (role === 'manager' && schoolIds.length) {
      const found = await rows('select id from schools where id = any($1)', [schoolIds]);
      if (found.length !== schoolIds.length) {
        throw badRequest('Danh sách school_ids có trường không tồn tại.');
      }
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const user = await tx(async (c) => {
      const r = await c.query(
        `insert into users (email, password_hash, full_name, phone, role, must_change_password, created_by)
         values ($1, $2, $3, $4, $5, true, $6)
         returning id, email, full_name, phone, role, is_active, must_change_password,
                   created_by, created_at, updated_at`,
        [emailAddr, passwordHash, fullName, phone, role, req.user.id]
      );
      const u = r.rows[0];
      if (role === 'manager' && schoolIds.length) {
        await c.query(
          `insert into user_schools (user_id, school_id)
           select $1, sid from unnest($2::uuid[]) as sid`,
          [u.id, schoolIds]
        );
      }
      return u;
    });

    const mail = await sendWelcome({
      to: user.email,
      fullName: user.full_name,
      tempPassword,
      roleLabel: ROLE_LABEL[role],
    });

    audit(req, {
      action: 'create',
      entity: 'users',
      entityId: user.id,
      summary: `Tạo tài khoản ${user.email} (${ROLE_LABEL[role]})`,
      after: { ...user, school_ids: role === 'manager' ? schoolIds : [] },
    });

    reply.code(201);
    return {
      user,
      email_sent: mail.sent,
      // Chỉ lộ mật khẩu tạm trên màn hình khi email KHÔNG gửi được
      ...(mail.sent ? {} : { temp_password: tempPassword }),
    };
  });

  /* ------------------------------------------------------------------------
   * GET /api/users/:id — chi tiết + trường phụ trách + lớp phụ trách
   * ---------------------------------------------------------------------- */
  app.get('/api/users/:id', { preHandler: requirePerm('users.view') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const user = await getVisibleUser(req.user, id);

    let schools = await rows(
      `select s.id, s.code, s.name, s.province
         from user_schools us join schools s on s.id = us.school_id
        where us.user_id = $1
        order by s.name`,
      [id]
    );
    let classes = await rows(
      `select c.id, c.name, c.level, c.grade, c.roster_size, ca.role,
              c.school_id, s.name as school_name
         from class_assignments ca
         join classes c on c.id = ca.class_id
         join schools s on s.id = c.school_id
        where ca.user_id = $1
        order by s.name, c.name`,
      [id]
    );

    // Manager: chỉ hiển thị phần thuộc phạm vi trường của mình
    if (!isAdmin(req.user)) {
      const ids = await visibleSchoolIds(req.user);
      if (ids !== null) {
        schools = schools.filter((s) => ids.includes(s.id));
        classes = classes.filter((c) => ids.includes(c.school_id));
      }
    }

    return { user, schools, classes };
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/users/:id — sửa tên / SĐT / vai trò / trạng thái (admin)
   * ---------------------------------------------------------------------- */
  app.patch('/api/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await one(
      'select id, email, full_name, phone, role, is_active from users u where id = $1',
      [id]
    );
    if (!before) throw notFound('Không tìm thấy người dùng.');

    const b = req.body || {};
    const sets = [];
    const params = [];
    let next = 1;

    if (b.full_name !== undefined) {
      const v = str(b.full_name, 'Họ và tên', { required: true, max: 200 });
      sets.push(`full_name = $${next++}`);
      params.push(v);
    }
    if (b.phone !== undefined) {
      const v = str(b.phone, 'Số điện thoại', { max: 30 });
      sets.push(`phone = $${next++}`);
      params.push(v);
    }
    if (b.role !== undefined) {
      const v = enumOf(b.role, 'Vai trò', ROLES, { required: true });
      sets.push(`role = $${next++}::user_role`);
      params.push(v);
    }
    if (b.is_active !== undefined) {
      const v = bool(b.is_active, 'is_active', { required: true });
      // Admin không thể tự khoá chính mình — tránh khoá sạch quyền quản trị
      if (id === req.user.id && v === false) {
        throw unprocessable('Bạn không thể tự khoá tài khoản của chính mình.');
      }
      sets.push(`is_active = $${next++}`);
      params.push(v);
    }
    if (!sets.length) throw badRequest('Không có trường nào để cập nhật.');

    params.push(id);
    const after = await one(
      `update users set ${sets.join(', ')} where id = $${next}
       returning id, email, full_name, phone, role, is_active, must_change_password,
                 created_at, updated_at`,
      params
    );

    // Khoá tài khoản ⇒ thu hồi mọi phiên đăng nhập ngay
    if (before.is_active && after.is_active === false) {
      await revokeAllUserTokens(id);
    }

    audit(req, {
      action: 'update',
      entity: 'users',
      entityId: id,
      summary: `Cập nhật tài khoản ${after.email}`,
      before,
      after,
    });

    return { user: after };
  });

  /* ------------------------------------------------------------------------
   * POST /api/users/:id/reset-password — cấp lại mật khẩu tạm (admin)
   * ---------------------------------------------------------------------- */
  app.post(
    '/api/users/:id/reset-password',
    { preHandler: requirePerm('users.manage') },
    async (req) => {
      const id = uuid(req.params.id, 'id', { required: true });
      const user = await one(
        'select id, email, full_name, role, is_active from users where id = $1',
        [id]
      );
      if (!user) throw notFound('Không tìm thấy người dùng.');

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      await query(
        'update users set password_hash = $1, must_change_password = true where id = $2',
        [passwordHash, id]
      );
      await revokeAllUserTokens(id);

      const mail = await sendWelcome({
        to: user.email,
        fullName: user.full_name,
        tempPassword,
        roleLabel: ROLE_LABEL[user.role],
      });

      audit(req, {
        action: 'reset_password',
        entity: 'users',
        entityId: id,
        summary: `Cấp lại mật khẩu tạm cho ${user.email}`,
      });

      return {
        email_sent: mail.sent,
        ...(mail.sent ? {} : { temp_password: tempPassword }),
      };
    }
  );

  /* ------------------------------------------------------------------------
   * DELETE /api/users/:id — vô hiệu hoá (soft delete, admin)
   * ---------------------------------------------------------------------- */
  app.delete('/api/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    if (id === req.user.id) {
      throw unprocessable('Bạn không thể tự vô hiệu hoá tài khoản của chính mình.');
    }
    const before = await one(
      'select id, email, full_name, role, is_active from users where id = $1',
      [id]
    );
    if (!before) throw notFound('Không tìm thấy người dùng.');

    await query('update users set is_active = false where id = $1', [id]);
    await revokeAllUserTokens(id);

    audit(req, {
      action: 'delete',
      entity: 'users',
      entityId: id,
      summary: `Vô hiệu hoá tài khoản ${before.email}`,
      before,
      after: { ...before, is_active: false },
    });

    return { ok: true };
  });

  /* ------------------------------------------------------------------------
   * PUT /api/users/:id/schools — gán phạm vi trường cho manager (admin)
   * ---------------------------------------------------------------------- */
  app.put('/api/users/:id/schools', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const user = await one('select id, email, full_name, role from users where id = $1', [id]);
    if (!user) throw notFound('Không tìm thấy người dùng.');
    if (user.role !== 'manager') {
      throw unprocessable('Chỉ gán phạm vi trường cho tài khoản Phòng chuyên môn (manager).');
    }

    const schoolIds = [...new Set(uuidList((req.body || {}).school_ids, 'school_ids'))];
    if (schoolIds.length) {
      const found = await rows('select id from schools where id = any($1)', [schoolIds]);
      if (found.length !== schoolIds.length) {
        throw badRequest('Danh sách school_ids có trường không tồn tại.');
      }
    }

    const beforeIds = (
      await rows('select school_id from user_schools where user_id = $1', [id])
    ).map((r) => r.school_id);

    // Xoá hết rồi chèn lại trong một giao dịch — trạng thái cuối luôn khớp school_ids
    await tx(async (c) => {
      await c.query('delete from user_schools where user_id = $1', [id]);
      if (schoolIds.length) {
        await c.query(
          `insert into user_schools (user_id, school_id)
           select $1, sid from unnest($2::uuid[]) as sid`,
          [id, schoolIds]
        );
      }
    });

    const schools = await rows(
      `select s.id, s.code, s.name from user_schools us
        join schools s on s.id = us.school_id
       where us.user_id = $1 order by s.name`,
      [id]
    );

    audit(req, {
      action: 'update',
      entity: 'user_schools',
      entityId: id,
      summary: `Cập nhật phạm vi trường của ${user.email} (${schoolIds.length} trường)`,
      before: { school_ids: beforeIds },
      after: { school_ids: schoolIds },
    });

    return { schools };
  });

  /* ------------------------------------------------------------------------
   * GET /api/users/:id/schedule — lịch cá nhân (admin / manager trong phạm vi / chính chủ)
   * ---------------------------------------------------------------------- */
  app.get('/api/users/:id/schedule', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });

    // Chính chủ luôn xem được; người khác cần users.view + trong phạm vi
    if (id !== req.user.id) {
      assertPerm(req.user, 'users.view');
      await getVisibleUser(req.user, id);
    }

    const { from, to } = dateRange(req.query || {});
    const { page, limit, offset } = paging(req.query || {});

    const params = [id, from, to];
    // Manager chỉ thấy buổi thuộc trường trong phạm vi mình (scheduleFilter)
    const sf = await scheduleFilter(req.user, 's', 4);
    const where = `(s.teacher_id = $1 or s.assistant_id = $1)
      and s.session_date between $2 and $3
      and ${sf.sql}`;
    params.push(...sf.params);
    const next = sf.next;

    const total = await scalar(`select count(*) from schedules s where ${where}`, params);
    const items = await rows(
      `select s.id, s.session_date, s.start_time, s.end_time, s.subject, s.status, s.note,
              s.school_id, sc.name as school_name,
              s.class_id, c.name as class_name, c.level,
              s.room_id, r.name as room_name,
              s.teacher_id, t.full_name as teacher_name,
              s.assistant_id, a.full_name as assistant_name,
              case when s.teacher_id = $1 then 'teacher' else 'assistant' end as session_role
         from schedules s
         join schools sc on sc.id = s.school_id
         join classes c on c.id = s.class_id
         left join stem_rooms r on r.id = s.room_id
         left join users t on t.id = s.teacher_id
         left join users a on a.id = s.assistant_id
        where ${where}
        order by s.session_date asc, s.start_time asc
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );

    return { items, total, page, limit, from, to };
  });
}
