/**
 * routes/periods.js — Khung TIẾT DẠY và BỘ GIỜ HỌC THEO MÙA của từng trường.
 *
 *   GET  /api/periods?school_id=&date=   khung tiết áp dụng cho trường vào ngày đó
 *   PUT  /api/periods                    khung CHUNG của hệ thống (admin)
 *   GET  /api/schools/:id/period-sets    các bộ giờ theo mùa của một trường
 *   POST /api/schools/:id/period-sets    thêm bộ giờ (admin, Phòng chuyên môn)
 *   PUT  /api/period-sets/:id            sửa tên / khoảng ngày / giờ từng tiết
 *   DELETE /api/period-sets/:id          xoá bộ giờ
 *
 * Giờ của buổi dạy được CHỐT lúc xếp lịch, nên sửa/xoá bộ giờ về sau KHÔNG làm
 * xê dịch bảng công của các buổi đã có.
 */
import { one, rows, tx } from '../db.js';
import { requireRole, requirePerm } from '../lib/rbac.js';
import { assertSchoolAccess } from '../lib/scope.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, uuid, bool, dateStr } from '../lib/validate.js';
import { listPeriods, savePeriods, normalizePeriods, MIN_PERIOD, MAX_PERIOD } from '../lib/periods.js';

const hhmm = (t) => String(t || '').slice(0, 5);

/** Một bộ giờ kèm danh sách tiết. */
async function loadSet(id) {
  const set = await one('select * from school_period_sets where id = $1', [id]);
  if (!set) return null;
  const times = await rows(
    'select no, start_time, end_time from school_period_times where set_id = $1 order by no',
    [id]
  );
  return { ...set, items: times.map((t) => ({ no: t.no, start: hhmm(t.start_time), end: hhmm(t.end_time) })) };
}

/** Ép kiểu phần thân tạo/sửa bộ giờ. */
function setFields(b, { partial = false } = {}) {
  const out = {};
  if (!partial || 'name' in b) out.name = str(b.name, 'Tên bộ giờ', { required: true, max: 120 });
  if (!partial || 'valid_from' in b) out.valid_from = dateStr(b.valid_from, 'Từ ngày', { required: true });
  if (!partial || 'valid_to' in b) out.valid_to = dateStr(b.valid_to, 'Đến ngày', { required: true });
  if ('is_active' in b) out.is_active = bool(b.is_active, 'is_active', { required: true });
  if ('note' in b) out.note = str(b.note, 'Ghi chú', { max: 500 });
  if (out.valid_from && out.valid_to && out.valid_to < out.valid_from) {
    throw badRequest('"Đến ngày" phải sau hoặc bằng "Từ ngày".');
  }
  if (!partial || 'items' in b) out.items = normalizePeriods(b.items);
  return out;
}

async function writeTimes(c, setId, items) {
  await c.query('delete from school_period_times where set_id = $1', [setId]);
  for (const p of items) {
    await c.query(
      'insert into school_period_times (set_id, no, start_time, end_time) values ($1, $2, $3, $4)',
      [setId, p.no, p.start, p.end]
    );
  }
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/periods — khung tiết áp dụng. Có school_id + date thì tra bộ giờ
   * theo mùa của trường; không thì trả khung chung.
   * ---------------------------------------------------------------------- */
  app.get('/api/periods', async (req) => {
    const schoolId = uuid(req.query.school_id, 'school_id');
    const date = dateStr(req.query.date, 'date');
    if (schoolId) await assertSchoolAccess(req.user, schoolId);
    const resolved = await listPeriods({ schoolId, date });
    return { ...resolved, min: MIN_PERIOD, max: MAX_PERIOD };
  });

  /* PUT /api/periods — thay TOÀN BỘ khung chung (admin). */
  app.put('/api/periods', { preHandler: requireRole('admin') }, async (req) => {
    const body = req.body || {};
    if (!Array.isArray(body.items)) throw badRequest('Thiếu danh sách tiết (items).');
    const before = (await listPeriods()).items;
    const items = await savePeriods(body.items, req.user.id);
    audit(req, {
      action: 'update',
      entity: 'app_settings',
      entityId: null,
      summary: `Cập nhật khung tiết chung của hệ thống (${items.length} tiết).`,
      before: { periods: before },
      after: { periods: items },
    });
    return { items, source: 'system', min: MIN_PERIOD, max: MAX_PERIOD };
  });

  /* ------------------------------------------------------------------------
   * Bộ giờ học theo mùa của từng trường — admin + Phòng chuyên môn (org.manage).
   * ---------------------------------------------------------------------- */
  app.get('/api/schools/:id/period-sets', async (req) => {
    const schoolId = uuid(req.params.id, 'id', { required: true });
    await assertSchoolAccess(req.user, schoolId);
    const sets = await rows(
      `select * from school_period_sets where school_id = $1
        order by valid_from desc, created_at desc`,
      [schoolId]
    );
    const items = [];
    for (const s of sets) items.push(await loadSet(s.id));
    return { items };
  });

  app.post('/api/schools/:id/period-sets', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const schoolId = uuid(req.params.id, 'id', { required: true });
    const school = await assertSchoolAccess(req.user, schoolId);
    const f = setFields(req.body || {});

    const id = await tx(async (c) => {
      const r = await c.query(
        `insert into school_period_sets (school_id, name, valid_from, valid_to, is_active, note, created_by)
         values ($1, $2, $3, $4, coalesce($5, true), $6, $7) returning id`,
        [schoolId, f.name, f.valid_from, f.valid_to, f.is_active ?? null, f.note ?? null, req.user.id]
      );
      await writeTimes(c, r.rows[0].id, f.items);
      return r.rows[0].id;
    });

    const saved = await loadSet(id);
    audit(req, {
      action: 'create',
      entity: 'school_period_sets',
      entityId: id,
      summary: `Thêm bộ giờ học "${f.name}" (${f.valid_from} → ${f.valid_to}, ${f.items.length} tiết) — ${school.name}.`,
      after: saved,
    });
    reply.code(201);
    return saved;
  });

  app.put('/api/period-sets/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await loadSet(id);
    if (!before) throw notFound('Không tìm thấy bộ giờ học.');
    const school = await assertSchoolAccess(req.user, before.school_id);
    const f = setFields(req.body || {}, { partial: true });
    const from = f.valid_from ?? String(before.valid_from).slice(0, 10);
    const to = f.valid_to ?? String(before.valid_to).slice(0, 10);
    if (to < from) throw badRequest('"Đến ngày" phải sau hoặc bằng "Từ ngày".');

    await tx(async (c) => {
      await c.query(
        `update school_period_sets set
           name = coalesce($2, name), valid_from = $3, valid_to = $4,
           is_active = coalesce($5, is_active), note = coalesce($6, note), updated_at = now()
         where id = $1`,
        [id, f.name ?? null, from, to, f.is_active ?? null, f.note ?? null]
      );
      if (f.items) await writeTimes(c, id, f.items);
    });

    const after = await loadSet(id);
    audit(req, {
      action: 'update',
      entity: 'school_period_sets',
      entityId: id,
      summary: `Sửa bộ giờ học "${after.name}" — ${school.name}.`,
      before,
      after,
    });
    return after;
  });

  app.delete('/api/period-sets/:id', { preHandler: requirePerm('org.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await loadSet(id);
    if (!before) throw notFound('Không tìm thấy bộ giờ học.');
    const school = await assertSchoolAccess(req.user, before.school_id);
    await one('delete from school_period_sets where id = $1 returning id', [id]);
    audit(req, {
      action: 'delete',
      entity: 'school_period_sets',
      entityId: id,
      summary: `Xoá bộ giờ học "${before.name}" — ${school.name}. Các buổi đã xếp giữ nguyên giờ.`,
      before,
    });
    return { ok: true };
  });
}
