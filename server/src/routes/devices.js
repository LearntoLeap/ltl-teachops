/**
 * devices.js — Thiết bị phòng STEM: danh mục thiết bị, kiểm kê theo mốc trong ngày,
 * báo cáo & xử lý sự cố hỏng/thiếu.
 *
 * Hợp đồng API: docs/API.md mục 7 · Nghiệp vụ: docs/ARCHITECTURE.md §5.3.
 */
import { rows, one, query, scalar, tx } from '../db.js';
import { badRequest, notFound, conflict, unprocessable } from '../lib/errors.js';
import { requirePerm, isFieldStaff } from '../lib/rbac.js';
import {
  schoolFilter, combine, visibleSchoolIds, assertSchoolAccess, assertRoomAccess,
} from '../lib/scope.js';
import { str, uuid, int, bool, enumOf, dateStr, isoTime, json, paging } from '../lib/validate.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';

/* ------------------------------ Hằng nghiệp vụ ----------------------------- */

const SLOT_LABEL = {
  morning_start: 'Đầu buổi sáng',
  morning_end: 'Cuối buổi sáng',
  afternoon_start: 'Đầu buổi chiều',
  afternoon_end: 'Cuối buổi chiều',
};
const DEVICE_SLOTS = Object.keys(SLOT_LABEL);

const ISSUE_STATUSES = ['new', 'in_progress', 'resolved'];
const ISSUE_LABEL = { new: 'Mới', in_progress: 'Đang xử lý', resolved: 'Đã khắc phục' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** Hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
const todayVN = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** 2026-09-10 → 10/09/2026 (hiển thị trong thông báo). */
const fmtDate = (d) => {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
};

/* ----------------------- Kiểm phạm vi trên một bản ghi ---------------------- */

/** Bản ghi danh mục thiết bị — ngoài phạm vi ⇒ 404 (không lộ sự tồn tại). */
async function getCatalogInScope(user, id) {
  const rec = await one('select * from device_catalog where id = $1', [id]);
  if (!rec) throw notFound('Không tìm thấy thiết bị trong danh mục.');
  if (user.role !== 'admin') {
    const ids = await visibleSchoolIds(user);
    if (!(ids === null || ids.includes(rec.school_id))) {
      throw notFound('Không tìm thấy thiết bị trong danh mục.');
    }
  }
  return rec;
}

/** Bản ghi sự cố thiết bị — ngoài phạm vi ⇒ 404. */
async function getIssueInScope(user, id) {
  const rec = await one('select * from device_issues where id = $1', [id]);
  if (!rec) throw notFound('Không tìm thấy sự cố thiết bị.');
  if (user.role !== 'admin') {
    const ids = await visibleSchoolIds(user);
    if (!(ids === null || ids.includes(rec.school_id))) {
      throw notFound('Không tìm thấy sự cố thiết bị.');
    }
  }
  return rec;
}

export default async function routes(app) {
  /* =========================================================================
   * DANH MỤC THIẾT BỊ — device_catalog
   * ======================================================================= */

  // GET /api/devices/catalog?school_id=&room_id= — danh mục đang hoạt động, theo phạm vi
  app.get('/api/devices/catalog', async (req) => {
    const q = req.query || {};
    const schoolId = uuid(q.school_id, 'school_id');
    const roomId = uuid(q.room_id, 'room_id');
    const { page, limit, offset } = paging(q);

    const filters = [{ sql: 'dc.is_active', params: [] }];
    let next = 1;
    if (schoolId) { filters.push({ sql: `dc.school_id = $${next}`, params: [schoolId] }); next += 1; }
    if (roomId) { filters.push({ sql: `dc.room_id = $${next}`, params: [roomId] }); next += 1; }
    const sf = await schoolFilter(req.user, 'dc.school_id', next);
    filters.push(sf);

    const { where, params } = combine('true', ...filters);

    const total = await scalar(`select count(*) from device_catalog dc where ${where}`, params);
    const items = await rows(
      `select dc.*, s.name as school_name, r.name as room_name
         from device_catalog dc
         join schools s on s.id = dc.school_id
         left join stem_rooms r on r.id = dc.room_id
        where ${where}
        order by dc.sort_order, dc.name
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items, total: Number(total || 0), page, limit };
  });

  // POST /api/devices/catalog — thêm thiết bị vào danh mục (admin/manager)
  app.post('/api/devices/catalog', { preHandler: requirePerm('device.catalog') }, async (req, reply) => {
    const b = req.body || {};
    const schoolId = uuid(b.school_id, 'school_id', { required: true });
    const roomId = uuid(b.room_id, 'room_id');
    const name = str(b.name, 'name', { required: true, max: 200 });
    const sku = str(b.sku, 'sku', { max: 100 });
    const unit = str(b.unit, 'unit', { max: 30 });
    const expectedQty = int(b.expected_qty, 'expected_qty', { min: 0, max: 1_000_000, def: 0 });
    const note = str(b.note, 'note', { max: 1000 });
    const sortOrder = int(b.sort_order, 'sort_order', { min: 0, max: 1_000_000, def: 0 });

    await assertSchoolAccess(req.user, schoolId);

    // Phòng (nếu có) phải thuộc đúng trường đã chọn
    if (roomId) {
      const room = await one('select id, school_id from stem_rooms where id = $1', [roomId]);
      if (!room) throw notFound('Không tìm thấy phòng STEM.');
      if (room.school_id !== schoolId) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
    }

    const row = await one(
      `insert into device_catalog (school_id, room_id, name, sku, unit, expected_qty, note, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [schoolId, roomId, name, sku, unit || 'bộ', expectedQty, note, sortOrder]
    );

    audit(req, {
      action: 'create', entity: 'device_catalog', entityId: row.id,
      summary: `Thêm thiết bị "${name}" vào danh mục`, after: row,
    });

    return reply.code(201).send(row);
  });

  // PATCH /api/devices/catalog/:id — sửa thông tin thiết bị
  app.patch('/api/devices/catalog/:id', { preHandler: requirePerm('device.catalog') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const rec = await getCatalogInScope(req.user, id);

    const b = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (has('room_id')) {
      const roomId = uuid(b.room_id, 'room_id');
      if (roomId) {
        const room = await one('select id, school_id from stem_rooms where id = $1', [roomId]);
        if (!room) throw notFound('Không tìm thấy phòng STEM.');
        if (room.school_id !== rec.school_id) {
          throw unprocessable('Phòng STEM không thuộc trường của thiết bị này.');
        }
      }
      set('room_id', roomId); // null ⇒ thiết bị dùng chung toàn trường
    }
    if (has('name')) set('name', str(b.name, 'name', { required: true, max: 200 }));
    if (has('sku')) set('sku', str(b.sku, 'sku', { max: 100 }));
    if (has('unit')) set('unit', str(b.unit, 'unit', { max: 30 }) || 'bộ');
    if (has('expected_qty')) {
      set('expected_qty', int(b.expected_qty, 'expected_qty', { required: true, min: 0, max: 1_000_000 }));
    }
    if (has('note')) set('note', str(b.note, 'note', { max: 1000 }));
    if (has('sort_order')) {
      set('sort_order', int(b.sort_order, 'sort_order', { required: true, min: 0, max: 1_000_000 }));
    }
    if (has('is_active')) set('is_active', bool(b.is_active, 'is_active', { required: true }));

    if (!sets.length) throw badRequest('Không có nội dung nào để cập nhật.');

    params.push(id);
    const updated = await one(
      `update device_catalog set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );

    audit(req, {
      action: 'update', entity: 'device_catalog', entityId: id,
      summary: `Sửa thiết bị "${updated.name}" trong danh mục`, before: rec, after: updated,
    });

    return updated;
  });

  // DELETE /api/devices/catalog/:id — ngừng sử dụng (soft delete)
  app.delete('/api/devices/catalog/:id', { preHandler: requirePerm('device.catalog') }, async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const rec = await getCatalogInScope(req.user, id);

    await query('update device_catalog set is_active = false where id = $1', [id]);

    audit(req, {
      action: 'delete', entity: 'device_catalog', entityId: id,
      summary: `Ngừng sử dụng thiết bị "${rec.name}" trong danh mục`, before: rec,
    });

    return reply.code(204).send();
  });

  /* =========================================================================
   * KIỂM KÊ THIẾT BỊ — device_checks
   * ======================================================================= */

  // GET /api/devices/checks?room_id=&school_id=&date=&slot=&from=&to=
  app.get('/api/devices/checks', async (req) => {
    const q = req.query || {};
    const roomId = uuid(q.room_id, 'room_id');
    const schoolId = uuid(q.school_id, 'school_id');
    const date = dateStr(q.date, 'date');
    const slot = enumOf(q.slot, 'slot', DEVICE_SLOTS);
    const from = dateStr(q.from, 'from');
    const to = dateStr(q.to, 'to');
    const { page, limit, offset } = paging(q);

    const filters = [];
    let next = 1;
    const add = (sql, ...ps) => { filters.push({ sql, params: ps }); next += ps.length; };

    if (roomId) add(`dc.room_id = $${next}`, roomId);
    if (schoolId) add(`dc.school_id = $${next}`, schoolId);
    if (date) add(`dc.check_date = $${next}::date`, date);
    if (slot) add(`dc.slot = $${next}`, slot);
    if (from) add(`dc.check_date >= $${next}::date`, from);
    if (to) add(`dc.check_date <= $${next}::date`, to);

    const sf = await schoolFilter(req.user, 'dc.school_id', next);
    filters.push(sf);

    const { where, params } = combine('true', ...filters);

    const total = await scalar(`select count(*) from device_checks dc where ${where}`, params);
    const items = await rows(
      `select dc.*, r.name as room_name, s.name as school_name, u.full_name as user_name,
              coalesce((select array_agg(p.file_id order by p.sort_order)
                          from device_check_photos p where p.check_id = dc.id), '{}'::uuid[]) as photos
         from device_checks dc
         join stem_rooms r on r.id = dc.room_id
         join schools s on s.id = dc.school_id
         join users u on u.id = dc.user_id
        where ${where}
        order by dc.check_date desc, dc.created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items, total: Number(total || 0), page, limit };
  });

  // POST /api/devices/checks — multipart: room_id, slot, items (JSON), photos[] ≥1, note?, check_date?, client_time?
  app.post('/api/devices/checks', { preHandler: requirePerm('device.check') }, async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('Yêu cầu phải gửi dạng multipart/form-data.');

    // school_id chỉ biết sau khi đọc room_id từ fields ⇒ lưu tệp trước, gắn school_id cho tệp sau.
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id });

    const roomId = uuid(fields.room_id, 'room_id', { required: true });
    const slot = enumOf(fields.slot, 'slot', DEVICE_SLOTS, { required: true });
    const note = str(fields.note, 'note', { max: 2000 });
    const checkDate = dateStr(fields.check_date, 'check_date') || todayVN();
    const clientTime = isoTime(fields.client_time, 'client_time');

    const photos = files.photos || [];
    if (!photos.length) throw unprocessable('Cần ít nhất 1 ảnh chụp thiết bị cho lượt kiểm kê.');

    const room = await assertRoomAccess(req.user, roomId);

    // Mốc kiểm kê phải được bật trong cấu hình schools.device_slots của trường
    const school = await one('select device_slots from schools where id = $1', [room.school_id]);
    if (!school || !(school.device_slots || []).includes(slot)) {
      throw unprocessable(`Trường này không cấu hình mốc kiểm kê "${SLOT_LABEL[slot]}".`);
    }

    // items: [{catalog_id, qty, note?}] — ép kiểu từng phần tử
    const rawItems = json(fields.items, 'items', { required: true });
    if (!Array.isArray(rawItems) || !rawItems.length) {
      throw badRequest('items phải là mảng có ít nhất một thiết bị.');
    }
    const items = rawItems.map((it, i) => ({
      catalog_id: uuid(it?.catalog_id, `items[${i}].catalog_id`, { required: true }),
      qty: int(it?.qty, `items[${i}].qty`, { required: true, min: 0, max: 1_000_000 }),
      note: str(it?.note, `items[${i}].note`, { max: 500 }),
    }));
    if (new Set(items.map((it) => it.catalog_id)).size !== items.length) {
      throw badRequest('items có thiết bị bị lặp lại.');
    }

    // Danh mục active của phòng (gồm thiết bị dùng chung toàn trường: room_id null)
    const catalog = await rows(
      `select id, name, expected_qty from device_catalog
        where school_id = $1 and is_active and (room_id is null or room_id = $2)`,
      [room.school_id, room.id]
    );
    const catById = new Map(catalog.map((c) => [c.id, c]));
    for (const it of items) {
      if (!catById.has(it.catalog_id)) {
        throw unprocessable('Danh sách kiểm kê có thiết bị không thuộc phòng/trường này.');
      }
    }

    // Mỗi mốc chỉ kiểm kê một lần trong ngày
    const dup = await one(
      'select 1 from device_checks where room_id = $1 and check_date = $2 and slot = $3',
      [room.id, checkDate, slot]
    );
    if (dup) throw conflict('Mốc này đã được kiểm kê hôm nay.');

    // Thiếu = đếm ít hơn expected_qty, hoặc bỏ sót mục đang kỳ vọng > 0
    const qtyById = new Map(items.map((it) => [it.catalog_id, it.qty]));
    const hasShortage = catalog.some((c) => {
      const qty = qtyById.get(c.id);
      return qty === undefined ? c.expected_qty > 0 : qty < c.expected_qty;
    });

    const check = await tx(async (c) => {
      const r = await c.query(
        `insert into device_checks
           (school_id, room_id, check_date, slot, user_id, items, note, has_shortage, client_time)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         returning *`,
        [room.school_id, room.id, checkDate, slot, req.user.id, JSON.stringify(items), note, hasShortage, clientTime]
      );
      const row = r.rows[0];
      for (let i = 0; i < photos.length; i++) {
        await c.query(
          'insert into device_check_photos (check_id, file_id, sort_order) values ($1, $2, $3)',
          [row.id, photos[i].id, i]
        );
      }
      // Gắn phạm vi trường cho ảnh để soát quyền xem tệp về sau
      await c.query('update files set school_id = $1 where id = any($2::uuid[])',
        [room.school_id, photos.map((p) => p.id)]);
      return row;
    });

    if (hasShortage) {
      await notifySchoolManagers(room.school_id, {
        kind: 'device_issue',
        title: 'Kiểm kê phát hiện lệch số lượng',
        body: `${room.school_name} · ${room.name} — mốc ${SLOT_LABEL[slot]} ngày ${fmtDate(checkDate)}.`,
        link: '/thiet-bi',
        refId: check.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo kiểm kê lệch số lượng'));
    }

    return reply.code(201).send({ ...check, photos: photos.map((p) => p.id) });
  });

  /* =========================================================================
   * SỰ CỐ THIẾT BỊ — device_issues
   * ======================================================================= */

  // GET /api/devices/issues?status=&school_id=&priority=&from=&to=
  app.get('/api/devices/issues', async (req) => {
    const q = req.query || {};
    const status = enumOf(q.status, 'status', ISSUE_STATUSES);
    const schoolId = uuid(q.school_id, 'school_id');
    const priority = enumOf(q.priority, 'priority', PRIORITIES);
    const from = dateStr(q.from, 'from');
    const to = dateStr(q.to, 'to');
    const { page, limit, offset } = paging(q);

    const filters = [];
    let next = 1;
    const add = (sql, ...ps) => { filters.push({ sql, params: ps }); next += ps.length; };

    if (status) add(`di.status = $${next}`, status);
    if (schoolId) add(`di.school_id = $${next}`, schoolId);
    if (priority) add(`di.priority = $${next}`, priority);
    if (from) add(`di.created_at >= $${next}::date`, from);
    if (to) add(`di.created_at < ($${next}::date + interval '1 day')`, to);

    if (isFieldStaff(req.user)) {
      // GV/TG: thấy sự cố mình báo + sự cố thuộc trường trong phạm vi của mình
      const ids = await visibleSchoolIds(req.user);
      if (ids && ids.length) {
        add(`(di.reported_by = $${next} or di.school_id = any($${next + 1}))`, req.user.id, ids);
      } else {
        add(`di.reported_by = $${next}`, req.user.id);
      }
    } else {
      const sf = await schoolFilter(req.user, 'di.school_id', next);
      filters.push(sf);
    }

    const { where, params } = combine('true', ...filters);

    const total = await scalar(`select count(*) from device_issues di where ${where}`, params);
    const items = await rows(
      `select di.*, s.name as school_name, r.name as room_name,
              ru.full_name as reported_by_name,
              au.full_name as assigned_to_name,
              rv.full_name as resolved_by_name,
              coalesce((select array_agg(p.file_id order by p.sort_order)
                          from device_issue_photos p where p.issue_id = di.id), '{}'::uuid[]) as photos
         from device_issues di
         join schools s on s.id = di.school_id
         left join stem_rooms r on r.id = di.room_id
         join users ru on ru.id = di.reported_by
         left join users au on au.id = di.assigned_to
         left join users rv on rv.id = di.resolved_by
        where ${where}
        order by di.created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items, total: Number(total || 0), page, limit };
  });

  // POST /api/devices/issues — multipart: school_id, room_id?, catalog_id?, device_name, quantity?, description, priority?, photos[]?
  app.post('/api/devices/issues', { preHandler: requirePerm('device.reportIssue') }, async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('Yêu cầu phải gửi dạng multipart/form-data.');

    // school_id nằm trong fields ⇒ lưu tệp trước, gắn school_id cho tệp sau.
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id });

    const schoolId = uuid(fields.school_id, 'school_id', { required: true });
    const roomId = uuid(fields.room_id, 'room_id');
    const catalogId = uuid(fields.catalog_id, 'catalog_id');
    const deviceName = str(fields.device_name, 'device_name', { required: true, max: 200 });
    const quantity = int(fields.quantity, 'quantity', { min: 1, max: 1_000_000, def: 1 });
    const description = str(fields.description, 'description', { required: true, max: 5000 });
    const priority = enumOf(fields.priority, 'priority', PRIORITIES, { def: 'normal' });

    // teacher/assistant: trường phải nằm trong visibleSchoolIds của họ (assertSchoolAccess lo việc này)
    const school = await assertSchoolAccess(req.user, schoolId);

    if (roomId) {
      const room = await one('select id from stem_rooms where id = $1 and school_id = $2', [roomId, schoolId]);
      if (!room) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
    }
    if (catalogId) {
      const cat = await one('select id from device_catalog where id = $1 and school_id = $2', [catalogId, schoolId]);
      if (!cat) throw unprocessable('Thiết bị trong danh mục không thuộc trường đã chọn.');
    }

    const photos = files.photos || [];

    const issue = await tx(async (c) => {
      const r = await c.query(
        `insert into device_issues
           (school_id, room_id, catalog_id, device_name, quantity, description, priority, source, reported_by)
         values ($1, $2, $3, $4, $5, $6, $7, 'manual', $8)
         returning *`,
        [schoolId, roomId, catalogId, deviceName, quantity, description, priority, req.user.id]
      );
      const row = r.rows[0];
      for (let i = 0; i < photos.length; i++) {
        await c.query(
          'insert into device_issue_photos (issue_id, file_id, sort_order) values ($1, $2, $3)',
          [row.id, photos[i].id, i]
        );
      }
      if (photos.length) {
        await c.query('update files set school_id = $1 where id = any($2::uuid[])',
          [schoolId, photos.map((p) => p.id)]);
      }
      return row;
    });

    await notifySchoolManagers(schoolId, {
      kind: 'device_issue',
      title: 'Có báo cáo sự cố thiết bị mới',
      body: `${school.name}: "${deviceName}" ×${quantity} — ${description.slice(0, 120)}`,
      link: '/thiet-bi',
      refId: issue.id,
    }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo sự cố thiết bị'));

    audit(req, {
      action: 'create', entity: 'device_issues', entityId: issue.id,
      summary: `Báo sự cố thiết bị "${deviceName}" tại ${school.name}`, after: issue,
    });

    return reply.code(201).send({ ...issue, photos: photos.map((p) => p.id) });
  });

  // PATCH /api/devices/issues/:id — đổi trạng thái / phân công / mức ưu tiên / nội dung khắc phục
  app.patch('/api/devices/issues/:id', { preHandler: requirePerm('device.resolveIssue') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const issue = await getIssueInScope(req.user, id);

    const b = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

    const status = has('status') ? enumOf(b.status, 'status', ISSUE_STATUSES, { required: true }) : null;
    const priority = has('priority') ? enumOf(b.priority, 'priority', PRIORITIES, { required: true }) : null;
    const resolution = has('resolution') ? str(b.resolution, 'resolution', { max: 5000 }) : undefined;

    let assignedTo; // undefined = không đụng tới; null = bỏ phân công
    if (has('assigned_to')) {
      assignedTo = uuid(b.assigned_to, 'assigned_to');
      if (assignedTo) {
        const u = await one('select 1 from users where id = $1 and is_active', [assignedTo]);
        if (!u) throw badRequest('Người được giao xử lý không tồn tại hoặc đã bị khoá.');
      }
    }

    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (priority) set('priority', priority);
    if (assignedTo !== undefined) set('assigned_to', assignedTo);
    if (resolution !== undefined) set('resolution', resolution);

    if (status) {
      set('status', status);
      if (status === 'resolved') {
        // Đóng sự cố bắt buộc phải có nội dung khắc phục
        const finalResolution = resolution !== undefined ? resolution : issue.resolution;
        if (!finalResolution) {
          throw unprocessable('Vui lòng nhập nội dung khắc phục (resolution) trước khi đóng sự cố.');
        }
        set('resolved_by', req.user.id);
        sets.push('resolved_at = now()');
      } else {
        // Mở lại sự cố ⇒ xoá dấu vết đã khắc phục
        set('resolved_by', null);
        set('resolved_at', null);
      }
    }

    if (!sets.length) throw badRequest('Không có nội dung nào để cập nhật.');

    params.push(id);
    const updated = await one(
      `update device_issues set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );

    // Báo cho người đã báo cáo sự cố (trừ khi chính họ thao tác)
    if (issue.reported_by && issue.reported_by !== req.user.id) {
      await notify(issue.reported_by, {
        kind: 'device_issue_update',
        title: `Sự cố thiết bị "${issue.device_name}" có cập nhật`,
        body: `Trạng thái: ${ISSUE_LABEL[updated.status]}${updated.resolution ? ` — ${String(updated.resolution).slice(0, 120)}` : ''}`,
        link: '/thiet-bi',
        refId: issue.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo cập nhật sự cố'));
    }

    audit(req, {
      action: 'update', entity: 'device_issues', entityId: id,
      summary: `Cập nhật sự cố thiết bị "${issue.device_name}"${status ? ` → ${ISSUE_LABEL[status]}` : ''}`,
      before: issue, after: updated,
    });

    return updated;
  });
}
