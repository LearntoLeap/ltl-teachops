/**
 * routes/rooms.js — Phòng STEM của trường (bảng stem_rooms).
 * Hợp đồng: docs/API.md mục 3 · Phạm vi dữ liệu: docs/ARCHITECTURE.md §3.
 *
 * Phạm vi đọc: theo visibleSchoolIds — với teacher/assistant, danh sách trường
 * nhìn thấy đã bao gồm các trường có buổi dạy/lớp được phân công của họ.
 */
import { rows, one, scalar } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import { schoolFilter, combine, assertSchoolAccess, assertRoomAccess } from '../lib/scope.js';
import { audit } from '../lib/audit.js';
import { conflict, badRequest } from '../lib/errors.js';
import { str, bool, uuid, paging } from '../lib/validate.js';

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/rooms — ?school_id=&is_active= + phân trang. Kèm school_name.
   * ---------------------------------------------------------------------- */
  app.get('/api/rooms', async (req) => {
    const schoolId = uuid(req.query.school_id, 'school_id');
    // Mặc định chỉ trả phòng ĐANG DÙNG — xem chú thích ở routes/schools.js.
    const includeInactive = bool(req.query.include_inactive, 'include_inactive', { def: false });
    const isActive = bool(req.query.is_active, 'is_active') ?? (includeInactive ? null : true);
    const { page, limit, offset } = paging(req.query);

    let next = 1;
    const filters = [];
    const scope = await schoolFilter(req.user, 'r.school_id', next);
    next = scope.next;
    filters.push(scope);
    if (schoolId) {
      filters.push({ sql: `r.school_id = $${next}`, params: [schoolId] });
      next += 1;
    }
    if (isActive !== null) {
      filters.push({ sql: `r.is_active = $${next}`, params: [isActive] });
      next += 1;
    }
    const { where, params } = combine(null, ...filters);

    const total = await scalar(`select count(*) from stem_rooms r where ${where}`, params);
    const items = await rows(
      `select r.*, s.name as school_name
         from stem_rooms r
         join schools s on s.id = r.school_id
        where ${where}
        order by s.name, r.name
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/rooms — admin, manager (org.manage) trong phạm vi trường.
   * ---------------------------------------------------------------------- */
  app.post('/api/rooms', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = req.body || {};
    const schoolId = uuid(b.school_id, 'school_id', { required: true });
    const name = str(b.name, 'name', { required: true, max: 100 });
    const note = str(b.note, 'note', { max: 1000 });

    await assertSchoolAccess(req.user, schoolId); // ngoài phạm vi ⇒ 404

    const dup = await one('select id from stem_rooms where school_id = $1 and name = $2', [schoolId, name]);
    if (dup) throw conflict(`Phòng "${name}" đã tồn tại trong trường này.`);

    const room = await one(
      'insert into stem_rooms (school_id, name, note) values ($1, $2, $3) returning *',
      [schoolId, name, note]
    );
    audit(req, {
      action: 'create',
      entity: 'stem_rooms',
      entityId: room.id,
      summary: `Tạo phòng STEM ${room.name}`,
      after: room,
    });
    return reply.code(201).send(room);
  });

  /* ------------------------------------------------------------------------
   * GET /api/rooms/:id — chi tiết (assertRoomAccess đã kèm school_name).
   * ---------------------------------------------------------------------- */
  app.get('/api/rooms/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    return assertRoomAccess(req.user, id); // ngoài phạm vi ⇒ 404
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/rooms/:id — org.manage.
   * ---------------------------------------------------------------------- */
  app.patch('/api/rooms/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertRoomAccess(req.user, id);

    const b = req.body || {};
    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if ('name' in b) {
      const name = str(b.name, 'name', { required: true, max: 100 });
      if (name !== before.name) {
        const dup = await one(
          'select id from stem_rooms where school_id = $1 and name = $2 and id <> $3',
          [before.school_id, name, id]
        );
        if (dup) throw conflict(`Phòng "${name}" đã tồn tại trong trường này.`);
      }
      set('name', name);
    }
    if ('note' in b) set('note', str(b.note, 'note', { max: 1000 }));

    if (!sets.length) throw badRequest('Không có thông tin nào để cập nhật.');

    params.push(id);
    const after = await one(
      `update stem_rooms set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    audit(req, {
      action: 'update',
      entity: 'stem_rooms',
      entityId: id,
      summary: `Cập nhật phòng STEM ${after.name}`,
      before,
      after,
    });
    return after;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/rooms/:id — org.manage. Soft delete: is_active = false.
   * ---------------------------------------------------------------------- */
  app.delete('/api/rooms/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertRoomAccess(req.user, id);
    const after = await one('update stem_rooms set is_active = false where id = $1 returning *', [id]);
    audit(req, {
      action: 'delete',
      entity: 'stem_rooms',
      entityId: id,
      summary: `Vô hiệu hoá phòng STEM ${before.name}`,
      before,
      after,
    });
    return { ok: true };
  });
}
