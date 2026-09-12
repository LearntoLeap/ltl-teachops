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
import { conflict, badRequest, notFound, forbidden } from '../lib/errors.js';
import { str, num, int, bool, uuid, enumOf, paging } from '../lib/validate.js';
import { sendXlsx } from '../lib/xlsx.js';

const MAX_BATCH_ROWS = 300;

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

/** Ép kiểu thân tạo trường — dùng chung cho tạo đơn lẻ và nhập bảng. */
function schoolFields(b) {
  return {
    code: str(b.code, 'Mã trường', { required: true, max: 30 }),
    name: str(b.name, 'Tên trường', { required: true, max: 200 }),
    address: str(b.address, 'Địa chỉ', { max: 500 }),
    province: str(b.province, 'Tỉnh/Thành phố', { max: 100 }),
    lat: num(b.lat, 'Vĩ độ', { min: -90, max: 90 }),
    lng: num(b.lng, 'Kinh độ', { min: -180, max: 180 }),
    gpsRadius: int(b.gps_radius_m, 'Bán kính GPS (m)', { min: 20, max: 5000 }),
    graceMinutes: int(b.grace_minutes, 'Phút ân hạn trễ', { min: 0, max: 120 }),
    deviceSlots: parseDeviceSlots(b.device_slots),
    contactName: str(b.contact_name, 'Người liên hệ', { max: 200 }),
    contactPhone: str(b.contact_phone, 'SĐT liên hệ', { max: 30 }),
  };
}

/**
 * Chèn trường mới. Manager tạo trường ⇒ tự đưa trường vào phạm vi phụ trách của
 * chính họ, nếu không họ sẽ không nhìn thấy trường vừa tạo (phạm vi đọc từ user_schools).
 * Các giá trị coalesce khớp default schema (1000m / 10 phút / đủ 4 mốc).
 */
async function insertSchool(user, f) {
  const dup = await one('select id from schools where code = $1', [f.code]);
  if (dup) throw conflict(`Mã trường "${f.code}" đã được sử dụng.`);

  return tx(async (c) => {
    const r = await c.query(
      `insert into schools
         (code, name, address, province, lat, lng, gps_radius_m, grace_minutes, device_slots,
          contact_name, contact_phone)
       values ($1, $2, $3, $4, $5, $6,
               coalesce($7, 1000), coalesce($8, 10),
               coalesce($9::device_slot[],
                        '{morning_start,morning_end,afternoon_start,afternoon_end}'::device_slot[]),
               $10, $11)
       returning *`,
      [f.code, f.name, f.address, f.province, f.lat, f.lng, f.gpsRadius, f.graceMinutes, f.deviceSlots,
       f.contactName, f.contactPhone]
    );
    const s = r.rows[0];
    if (user.role === 'manager') {
      await c.query(
        'insert into user_schools (user_id, school_id) values ($1, $2) on conflict do nothing',
        [user.id, s.id]
      );
    }
    return s;
  });
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
    const school = await insertSchool(req.user, schoolFields(req.body || {}));

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
   * POST /api/schools/batch — nhập NHIỀU trường một lượt (dạng bảng / dán Excel).
   * body: { rows: [{ code, name, address?, province?, lat?, lng?, gps_radius_m?,
   *                  grace_minutes?, contact_name?, contact_phone? }] }
   * Dòng lỗi (trùng mã, thiếu tên…) bị bỏ qua và trả về trong `skipped`.
   * ---------------------------------------------------------------------- */
  app.post('/api/schools/batch', { preHandler: requirePerm('org.manage') }, async (req) => {
    const rowsIn = req.body?.rows;
    if (!Array.isArray(rowsIn) || !rowsIn.length) throw badRequest('Chưa có dòng nào để tạo.');
    if (rowsIn.length > MAX_BATCH_ROWS) {
      throw badRequest(`Mỗi lượt nhập tối đa ${MAX_BATCH_ROWS} dòng (đang có ${rowsIn.length}).`);
    }

    const created = [];
    const skipped = [];
    for (let i = 0; i < rowsIn.length; i++) {
      try {
        const s = await insertSchool(req.user, schoolFields(rowsIn[i] || {}));
        created.push({ id: s.id, code: s.code, name: s.name });
      } catch (e) {
        skipped.push({ row: i + 1, reason: e.message || 'Dòng không hợp lệ.' });
      }
    }

    if (created.length) {
      audit(req, {
        action: 'create', entity: 'schools',
        summary: `Nhập bảng trường: tạo ${created.length} trường` +
          `${skipped.length ? `, bỏ qua ${skipped.length} dòng` : ''}.`,
        after: { created, skipped },
      });
    }
    return { created: created.length, items: created, skipped };
  });

  /* GET /api/schools/batch-template — tệp Excel mẫu đúng thứ tự cột của bảng nhập. */
  app.get('/api/schools/batch-template', { preHandler: requirePerm('org.manage') }, async (req, reply) =>
    sendXlsx(reply, {
      fileName: 'mau-nhap-truong',
      sheetName: 'Nhập trường',
      title: 'MẪU NHẬP DANH SÁCH TRƯỜNG — LtL TeachOps',
      subtitle: 'Điền từ dòng 5 (xoá 2 dòng ví dụ) → bôi đen các dòng dữ liệu → Copy → bấm Ctrl+V trên bảng "Nhập bảng trường"',
      columns: [
        { header: 'Mã trường *', key: 'code', width: 14 },
        { header: 'Tên trường *', key: 'name', width: 32 },
        { header: 'Địa chỉ', key: 'address', width: 34 },
        { header: 'Tỉnh / Thành phố', key: 'province', width: 16 },
        { header: 'Toạ độ GPS (vĩ độ, kinh độ)', key: 'gps', width: 26 },
        { header: 'Bán kính chấm công (m)', key: 'radius', width: 14, align: 'center' },
        { header: 'Phút ân hạn trễ', key: 'grace', width: 12, align: 'center' },
        { header: 'Người liên hệ', key: 'contact', width: 22 },
        { header: 'SĐT liên hệ', key: 'phone', width: 14 },
      ],
      rows: [
        { code: 'VD-THCS01', name: 'THCS Nguyễn Trãi (ví dụ)', address: '12 Lý Thái Tổ', province: 'Bắc Ninh', gps: '21.1861, 106.0763', radius: 1000, grace: 10, contact: 'Cô Hoa — Hiệu phó', phone: '0912345678' },
        { code: 'VD-TH02', name: 'Tiểu học Kim Đồng (ví dụ)', address: '', province: 'Hà Nội', gps: '', radius: '', grace: '', contact: '', phone: '' },
      ],
    }));

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
    if ('checkout_grace_minutes' in b) {
      // Khung giờ check-out là tham số tính công ⇒ CHỈ Quản trị viên chỉnh.
      if (req.user.role !== 'admin') {
        throw forbidden('Chỉ Quản trị viên được chỉnh khung giờ check-out.');
      }
      set('checkout_grace_minutes',
        int(b.checkout_grace_minutes, 'checkout_grace_minutes', { required: true, min: 5, max: 240 }));
    }

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
