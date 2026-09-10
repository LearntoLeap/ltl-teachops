/**
 * routes/schools.js — Trường học: danh sách, tạo mới, chi tiết, sửa cấu hình, vô hiệu hoá.
 * Hợp đồng: docs/API.md mục 3 · Phạm vi dữ liệu: docs/ARCHITECTURE.md §3.
 *
 * Lưu ý nghiệp vụ: gps_radius_m / grace_minutes / device_slots ảnh hưởng trực tiếp
 * tới chấm công và kiểm kê thiết bị ⇒ mọi thay đổi đều ghi audit đầy đủ before/after.
 */
import { rows, one, scalar, tx } from '../db.js';
import { requirePerm, requireRole } from '../lib/rbac.js';
import { schoolFilter, combine, assertSchoolAccess } from '../lib/scope.js';
import { audit } from '../lib/audit.js';
import { conflict, badRequest, notFound } from '../lib/errors.js';
import { str, num, int, bool, uuid, enumOf, paging } from '../lib/validate.js';

// Khớp enum device_slot trong 001_init.sql
const DEVICE_SLOTS = ['morning_start', 'morning_end', 'afternoon_start', 'afternoon_end'];

/** Ép kiểu mảng device_slots; trả null nếu client không gửi. Mảng rỗng = tắt hết các mốc. */
function parseDeviceSlots(v) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw badRequest('device_slots phải là mảng các mốc kiểm thiết bị.');
  const out = [];
  for (const item of v) {
    const slot = enumOf(item, 'device_slots', DEVICE_SLOTS, { required: true });
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/schools — mọi vai trò, tự lọc theo phạm vi (admin thấy tất cả).
   * ?q= tìm theo mã/tên · ?is_active= · phân trang chuẩn.
   * ---------------------------------------------------------------------- */
  app.get('/api/schools', async (req) => {
    const q = str(req.query.q, 'q', { max: 100 });
    const isActive = bool(req.query.is_active, 'is_active');
    const { page, limit, offset } = paging(req.query);

    let next = 1;
    const filters = [];
    const scope = await schoolFilter(req.user, 's.id', next);
    next = scope.next;
    filters.push(scope);
    if (q !== null) {
      filters.push({ sql: `(s.name ilike $${next} or s.code ilike $${next})`, params: [`%${q}%`] });
      next += 1;
    }
    if (isActive !== null) {
      filters.push({ sql: `s.is_active = $${next}`, params: [isActive] });
      next += 1;
    }
    const { where, params } = combine(null, ...filters);

    const total = await scalar(`select count(*) from schools s where ${where}`, params);
    const items = await rows(
      `select s.*,
              (select count(*) from classes c    where c.school_id = s.id and c.is_active) as classes_count,
              (select count(*) from stem_rooms r where r.school_id = s.id and r.is_active) as rooms_count
         from schools s
        where ${where}
        order by s.name
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/schools — admin, manager (org.manage).
   * ---------------------------------------------------------------------- */
  app.post('/api/schools', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = req.body || {};
    const code = str(b.code, 'code', { required: true, max: 30 });
    const name = str(b.name, 'name', { required: true, max: 200 });
    const address = str(b.address, 'address', { max: 500 });
    const province = str(b.province, 'province', { max: 100 });
    const lat = num(b.lat, 'lat', { min: -90, max: 90 });
    const lng = num(b.lng, 'lng', { min: -180, max: 180 });
    const gpsRadius = int(b.gps_radius_m, 'gps_radius_m', { min: 20, max: 5000 });
    const graceMinutes = int(b.grace_minutes, 'grace_minutes', { min: 0, max: 120 });
    const deviceSlots = parseDeviceSlots(b.device_slots);
    const contactName = str(b.contact_name, 'contact_name', { max: 200 });
    const contactPhone = str(b.contact_phone, 'contact_phone', { max: 30 });

    const dup = await one('select id from schools where code = $1', [code]);
    if (dup) throw conflict(`Mã trường "${code}" đã được sử dụng.`);

    // Manager tạo trường ⇒ tự đưa trường vào phạm vi phụ trách của chính họ,
    // nếu không họ sẽ không nhìn thấy trường vừa tạo (phạm vi đọc từ user_schools).
    // Các giá trị coalesce khớp default của 001_init.sql (150m / 10 phút / đủ 4 mốc).
    const school = await tx(async (c) => {
      const r = await c.query(
        `insert into schools
           (code, name, address, province, lat, lng, gps_radius_m, grace_minutes, device_slots,
            contact_name, contact_phone)
         values ($1, $2, $3, $4, $5, $6,
                 coalesce($7, 150), coalesce($8, 10),
                 coalesce($9::device_slot[],
                          '{morning_start,morning_end,afternoon_start,afternoon_end}'::device_slot[]),
                 $10, $11)
         returning *`,
        [code, name, address, province, lat, lng, gpsRadius, graceMinutes, deviceSlots,
         contactName, contactPhone]
      );
      const s = r.rows[0];
      if (req.user.role === 'manager') {
        await c.query(
          'insert into user_schools (user_id, school_id) values ($1, $2) on conflict do nothing',
          [req.user.id, s.id]
        );
      }
      return s;
    });

    audit(req, {
      action: 'create',
      entity: 'schools',
      entityId: school.id,
      summary: `Tạo trường ${school.code} — ${school.name}`,
      after: school,
    });
    return reply.code(201).send(school);
  });

  /* ------------------------------------------------------------------------
   * GET /api/schools/:id — chi tiết + danh sách lớp & phòng đang hoạt động.
   * ---------------------------------------------------------------------- */
  app.get('/api/schools/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const school = await assertSchoolAccess(req.user, id);
    const [classes, stemRooms] = await Promise.all([
      rows('select * from classes where school_id = $1 and is_active order by name', [id]),
      rows('select * from stem_rooms where school_id = $1 and is_active order by name', [id]),
    ]);
    return { ...school, classes, rooms: stemRooms };
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/schools/:id — org.manage; manager chỉ sửa trường trong phạm vi.
   * Sửa được mọi trường cấu hình, kể cả gps_radius_m / grace_minutes / device_slots.
   * ---------------------------------------------------------------------- */
  app.patch('/api/schools/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertSchoolAccess(req.user, id); // ngoài phạm vi ⇒ 404

    const b = req.body || {};
    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if ('code' in b) {
      const code = str(b.code, 'code', { required: true, max: 30 });
      if (code !== before.code) {
        const dup = await one('select id from schools where code = $1 and id <> $2', [code, id]);
        if (dup) throw conflict(`Mã trường "${code}" đã được sử dụng.`);
      }
      set('code', code);
    }
    if ('name' in b) set('name', str(b.name, 'name', { required: true, max: 200 }));
    if ('address' in b) set('address', str(b.address, 'address', { max: 500 }));
    if ('province' in b) set('province', str(b.province, 'province', { max: 100 }));
    if ('lat' in b) set('lat', num(b.lat, 'lat', { min: -90, max: 90 }));
    if ('lng' in b) set('lng', num(b.lng, 'lng', { min: -180, max: 180 }));
    if ('gps_radius_m' in b) {
      set('gps_radius_m', int(b.gps_radius_m, 'gps_radius_m', { required: true, min: 20, max: 5000 }));
    }
    if ('grace_minutes' in b) {
      set('grace_minutes', int(b.grace_minutes, 'grace_minutes', { required: true, min: 0, max: 120 }));
    }
    if ('device_slots' in b) {
      const slots = parseDeviceSlots(b.device_slots);
      if (slots === null) throw badRequest('device_slots phải là mảng các mốc kiểm thiết bị.');
      params.push(slots);
      sets.push(`device_slots = $${params.length}::device_slot[]`);
    }
    if ('contact_name' in b) set('contact_name', str(b.contact_name, 'contact_name', { max: 200 }));
    if ('contact_phone' in b) set('contact_phone', str(b.contact_phone, 'contact_phone', { max: 30 }));

    if (!sets.length) throw badRequest('Không có thông tin nào để cập nhật.');

    params.push(id);
    const after = await one(
      `update schools set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );

    // Đổi bán kính GPS / ngưỡng trễ tác động thẳng tới kết quả chấm công ⇒ audit đầy đủ.
    audit(req, {
      action: 'update',
      entity: 'schools',
      entityId: id,
      summary: `Cập nhật trường ${after.code} — ${after.name}`,
      before,
      after,
    });
    return after;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/schools/:id — chỉ admin. Soft delete: is_active = false.
   * ---------------------------------------------------------------------- */
  app.delete('/api/schools/:id', { preHandler: requireRole('admin') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await one('select * from schools where id = $1', [id]);
    if (!before) throw notFound('Không tìm thấy trường.');

    const after = await one('update schools set is_active = false where id = $1 returning *', [id]);
    audit(req, {
      action: 'delete',
      entity: 'schools',
      entityId: id,
      summary: `Vô hiệu hoá trường ${before.code} — ${before.name}`,
      before,
      after,
    });
    return { ok: true };
  });
}
