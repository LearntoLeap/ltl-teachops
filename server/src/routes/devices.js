/**
 * devices.js — Thiết bị phòng STEM: danh mục thiết bị chuẩn của từng phòng,
 * báo hỏng đột xuất / đề nghị bổ sung, và xử lý các phiếu đó.
 *
 * KHÔNG còn thao tác kiểm kê ở đây: đếm thiết bị đầu/cuối buổi là một bước của
 * CHẤM CÔNG (routes/timesheets.js) — thiếu hoặc hỏng lúc check-out tự mở phiếu
 * báo hỏng. Dữ liệu kiểm kê cũ vẫn xem và xuất báo cáo được (GET /devices/checks).
 *
 * Hợp đồng API: docs/API.md mục 7 · Nghiệp vụ: docs/ARCHITECTURE.md §5.3.
 */
import { randomUUID } from 'node:crypto';
import { rows, one, query, scalar, tx } from '../db.js';
import { badRequest, notFound, conflict, unprocessable } from '../lib/errors.js';
import { requirePerm, requireRole, isFieldStaff } from '../lib/rbac.js';
import { schoolFilter, combine, visibleSchoolIds, assertSchoolAccess } from '../lib/scope.js';
import { str, uuid, int, bool, enumOf, dateStr, json, paging } from '../lib/validate.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';

/* ------------------------------ Hằng nghiệp vụ ----------------------------- */

/** Mốc kiểm kê cũ — chỉ còn dùng để LỌC và hiển thị dữ liệu lịch sử. */
const DEVICE_SLOTS = ['morning_start', 'morning_end', 'afternoon_start', 'afternoon_end'];

const ISSUE_STATUSES = ['new', 'in_progress', 'resolved'];
/** Loại phiếu: hỏng cần sửa/thay · cần mua thêm cho đủ dùng. */
const ISSUE_KINDS = ['broken', 'restock'];
const KIND_LABEL = { broken: 'Báo hỏng', restock: 'Đề nghị bổ sung' };
/** Một lần báo tối đa bao nhiêu thiết bị (báo hỏng hàng loạt). */
const MAX_ISSUE_LINES = 50;
const ISSUE_LABEL = { new: 'Mới', in_progress: 'Đang xử lý', resolved: 'Đã khắc phục' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

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
  /* ------------------------------------------------------------------------
   * GET /api/devices/suggestions — danh mục thiết bị ĐỀ XUẤT dùng chung.
   * Dùng để gợi ý khi khai báo danh mục cho một phòng (uKIT, UGOT, laptop,
   * tablet, loa, mic…), mỗi mục kèm số lượng gợi ý sẵn để sửa lại.
   * ---------------------------------------------------------------------- */
  app.get('/api/devices/suggestions', async () => ({
    items: await rows(
      `select id, name, category, unit, default_qty, icon, sort_order
         from device_suggestions where is_active
        order by sort_order, name`
    ),
  }));

  /* POST /api/devices/suggestions — Admin bổ sung mục gợi ý mới. */
  app.post('/api/devices/suggestions', { preHandler: requireRole('admin') }, async (req, reply) => {
    const b = req.body || {};
    const name = str(b.name, 'Tên thiết bị', { required: true, max: 200 });
    const category = enumOf(b.category, 'category', ['robotics', 'computer', 'av', 'other'], { def: 'other' });
    const unit = str(b.unit, 'unit', { max: 30 }) || 'bộ';
    const defaultQty = int(b.default_qty, 'default_qty', { min: 0, max: 100_000, def: 1 });
    const icon = str(b.icon, 'icon', { max: 8 }) || '📦';

    const dup = await one('select id from device_suggestions where lower(name) = lower($1)', [name]);
    if (dup) throw conflict(`Thiết bị "${name}" đã có trong danh mục đề xuất.`);

    const row = await one(
      `insert into device_suggestions (name, category, unit, default_qty, icon, sort_order, created_by)
       values ($1, $2, $3, $4, $5,
               (select coalesce(max(sort_order), 0) + 10 from device_suggestions), $6)
       returning id, name, category, unit, default_qty, icon, sort_order`,
      [name, category, unit, defaultQty, icon, req.user.id]
    );
    audit(req, {
      action: 'create', entity: 'device_suggestions', entityId: row.id,
      summary: `Thêm thiết bị đề xuất "${row.name}"`,
    });
    return reply.code(201).send(row);
  });

  /* ------------------------------------------------------------------------
   * POST /api/devices/catalog/bulk — khai báo NHIỀU thiết bị một lượt cho phòng.
   * body: { school_id, room_id?, items: [{name, unit?, expected_qty, sku?}] }
   * Tên đã có trong phòng ⇒ CẬP NHẬT số lượng chuẩn thay vì tạo trùng.
   * ---------------------------------------------------------------------- */
  app.post('/api/devices/catalog/bulk', { preHandler: requirePerm('device.catalog') }, async (req, reply) => {
    const b = req.body || {};
    const schoolId = uuid(b.school_id, 'school_id', { required: true });
    const roomId = uuid(b.room_id, 'room_id');
    if (!Array.isArray(b.items) || !b.items.length) {
      throw badRequest('Cần chọn ít nhất một thiết bị.');
    }
    if (b.items.length > 100) throw badRequest('Mỗi lượt khai báo tối đa 100 thiết bị.');

    await assertSchoolAccess(req.user, schoolId);
    if (roomId) {
      const room = await one('select id, school_id from stem_rooms where id = $1', [roomId]);
      if (!room) throw notFound('Không tìm thấy phòng STEM.');
      if (room.school_id !== schoolId) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
    }

    const items = b.items.map((it, i) => ({
      name: str(it?.name, `items[${i}].name`, { required: true, max: 200 }),
      unit: str(it?.unit, `items[${i}].unit`, { max: 30 }) || 'bộ',
      qty: int(it?.expected_qty, `items[${i}].expected_qty`, { min: 0, max: 1_000_000, def: 0 }),
      sku: str(it?.sku, `items[${i}].sku`, { max: 100 }),
      sort: int(it?.sort_order, `items[${i}].sort_order`, { min: 0, max: 1_000_000, def: (i + 1) * 10 }),
    }));

    const result = await tx(async (c) => {
      let created = 0;
      let updated = 0;
      for (const it of items) {
        const existing = await c.query(
          `select id from device_catalog
            where school_id = $1 and name = $2 and is_active
              and (room_id is not distinct from $3)`,
          [schoolId, it.name, roomId]
        );
        if (existing.rows.length) {
          await c.query(
            'update device_catalog set expected_qty = $2, unit = $3 where id = $1',
            [existing.rows[0].id, it.qty, it.unit]
          );
          updated += 1;
        } else {
          await c.query(
            `insert into device_catalog (school_id, room_id, name, sku, unit, expected_qty, sort_order)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [schoolId, roomId, it.name, it.sku, it.unit, it.qty, it.sort]
          );
          created += 1;
        }
      }
      return { created, updated };
    });

    audit(req, {
      action: 'create', entity: 'device_catalog',
      summary: `Khai báo danh mục thiết bị: thêm ${result.created}, cập nhật ${result.updated} mục`,
      after: { school_id: schoolId, room_id: roomId, count: items.length },
    });
    return reply.code(201).send(result);
  });

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
   * LỊCH SỬ KIỂM KÊ — device_checks (CHỈ ĐỌC)
   *
   * Việc kiểm đếm thiết bị nay nằm trong CHẤM CÔNG đầu/cuối buổi (timesheets:
   * check_in_devices / check_out_devices), không còn thao tác riêng ở mục Thiết
   * bị nữa. Endpoint này giữ lại để xem và xuất báo cáo dữ liệu cũ.
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


  /* =========================================================================
   * SỰ CỐ THIẾT BỊ — device_issues
   * ======================================================================= */

  // GET /api/devices/issues?status=&school_id=&priority=&from=&to=
  app.get('/api/devices/issues', async (req) => {
    const q = req.query || {};
    const status = enumOf(q.status, 'status', ISSUE_STATUSES);
    const kind = enumOf(q.kind, 'kind', ISSUE_KINDS);
    const schoolId = uuid(q.school_id, 'school_id');
    const priority = enumOf(q.priority, 'priority', PRIORITIES);
    const from = dateStr(q.from, 'from');
    const to = dateStr(q.to, 'to');
    const { page, limit, offset } = paging(q);

    const filters = [];
    let next = 1;
    const add = (sql, ...ps) => { filters.push({ sql, params: ps }); next += ps.length; };

    if (status) add(`di.status = $${next}`, status);
    if (kind) add(`di.kind = $${next}`, kind);
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

  /* POST /api/devices/issues — multipart. Hai việc của mục Thiết bị:
   *   - báo hỏng đột xuất (kind=broken, mặc định)
   *   - đề nghị bổ sung / cần mua thêm (kind=restock)
   *
   * Một thiết bị : catalog_id? | device_name (+ quantity?)
   * Nhiều thiết bị (báo hỏng hàng loạt): items = JSON
   *   [{catalog_id?, device_name?, quantity?}] — tối đa ${MAX_ISSUE_LINES} dòng.
   * Mỗi thiết bị vẫn là MỘT phiếu để theo dõi và khắc phục riêng, nhưng cùng
   * một lần báo thì dùng chung batch_id.
   *
   * Trả { created, batch_id, kind, items[] }.
   */
  app.post('/api/devices/issues', { preHandler: requirePerm('device.reportIssue') }, async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('Yêu cầu phải gửi dạng multipart/form-data.');

    // school_id nằm trong fields ⇒ lưu tệp trước, gắn school_id cho tệp sau.
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, allowVideo: true });

    const schoolId = uuid(fields.school_id, 'school_id', { required: true });
    const roomId = uuid(fields.room_id, 'room_id');
    const kind = enumOf(fields.kind, 'kind', ISSUE_KINDS, { def: 'broken' });
    const description = str(fields.description, 'description', { required: true, max: 5000 });
    const priority = enumOf(fields.priority, 'priority', PRIORITIES, { def: 'normal' });

    // teacher/assistant: trường phải nằm trong visibleSchoolIds của họ (assertSchoolAccess lo việc này)
    const school = await assertSchoolAccess(req.user, schoolId);

    if (roomId) {
      const room = await one('select id from stem_rooms where id = $1 and school_id = $2', [roomId, schoolId]);
      if (!room) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
    }

    // Danh sách thiết bị: nhiều dòng (items) hoặc một dòng như trước.
    const raw = json(fields.items, 'items');
    const lines = Array.isArray(raw) && raw.length
      ? raw
      : [{ catalog_id: fields.catalog_id, device_name: fields.device_name, quantity: fields.quantity }];
    if (lines.length > MAX_ISSUE_LINES) {
      throw badRequest(`Mỗi lần báo tối đa ${MAX_ISSUE_LINES} thiết bị (đang có ${lines.length}).`);
    }

    const items = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || {};
      const label = lines.length > 1 ? `Thiết bị dòng ${i + 1}` : 'Tên thiết bị';
      const catalogId = uuid(line.catalog_id, 'catalog_id');
      let name = str(line.device_name, label, { max: 200 });
      if (catalogId) {
        const cat = await one(
          'select id, name from device_catalog where id = $1 and school_id = $2', [catalogId, schoolId]
        );
        if (!cat) throw unprocessable('Thiết bị trong danh mục không thuộc trường đã chọn.');
        name = name || cat.name;
      }
      if (!name) throw badRequest(`${label}: hãy chọn thiết bị trong danh mục hoặc nhập tên.`);
      items.push({
        catalogId,
        name,
        quantity: int(line.quantity, 'Số lượng', { min: 1, max: 1_000_000, def: 1 }),
      });
    }

    const photos = files.photos || [];
    const batchId = items.length > 1 ? randomUUID() : null;

    const created = await tx(async (c) => {
      const out = [];
      for (const it of items) {
        const r = await c.query(
          `insert into device_issues
             (school_id, room_id, catalog_id, device_name, quantity, description,
              priority, kind, batch_id, source, reported_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10)
           returning *`,
          [schoolId, roomId, it.catalogId, it.name, it.quantity, description,
            priority, kind, batchId, req.user.id]
        );
        const row = r.rows[0];
        // Ảnh minh chứng gắn cho từng phiếu để mở phiếu nào cũng thấy.
        for (let i = 0; i < photos.length; i++) {
          await c.query(
            'insert into device_issue_photos (issue_id, file_id, sort_order) values ($1, $2, $3)',
            [row.id, photos[i].id, i]
          );
        }
        out.push(row);
      }
      if (photos.length) {
        await c.query('update files set school_id = $1 where id = any($2::uuid[])',
          [schoolId, photos.map((p) => p.id)]);
      }
      return out;
    });

    const what = created.map((r) => `${r.device_name} ×${r.quantity}`).join(', ');
    await notifySchoolManagers(schoolId, {
      kind: 'device_issue',
      title: kind === 'restock' ? 'Có đề nghị bổ sung thiết bị' : 'Có báo hỏng thiết bị mới',
      body: `${school.name}: ${what.slice(0, 200)} — ${description.slice(0, 120)}`,
      link: '/thiet-bi',
      refId: created[0].id,
    }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo sự cố thiết bị'));

    audit(req, {
      action: 'create', entity: 'device_issues', entityId: created[0].id,
      summary: `${KIND_LABEL[kind]} ${created.length} thiết bị tại ${school.name}: ${what}`,
      after: {
        kind,
        batch_id: batchId,
        items: created.map((r) => ({ id: r.id, device_name: r.device_name, quantity: r.quantity })),
      },
    });

    return reply.code(201).send({
      created: created.length,
      batch_id: batchId,
      kind,
      items: created.map((r) => ({ ...r, photos: photos.map((p) => p.id) })),
    });
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
