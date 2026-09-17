/**
 * attendance.js — Điểm danh học sinh (docs/API.md mục 6 · ARCHITECTURE.md §5.2).
 *
 * Nguyên tắc:
 *   - class_id / school_id / roster_size / marked_by LUÔN suy ra từ schedules — không tin client.
 *   - Bản ghi ngoài phạm vi ⇒ 404 (notFound), không phải 403.
 *   - Bắt buộc tối thiểu 1 ảnh tổng quan lớp khi điểm danh.
 */
import { one, rows, scalar, tx } from '../db.js';
import { requirePerm, isFieldStaff } from '../lib/rbac.js';
import { schoolFilter, assertScheduleAccess, roleInSchedule, visibleSchoolIds } from '../lib/scope.js';
import { badRequest, forbidden, notFound, conflict, unprocessable } from '../lib/errors.js';
import { str, uuid, int, dateStr, isoTime, paging } from '../lib/validate.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' cho thông báo/nhật ký. */
const vnDate = (d) => {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
};

/** Ảnh điểm danh dưới dạng mảng file_id, đúng thứ tự sort_order. */
const PHOTOS_LATERAL = `
  left join lateral (
    select coalesce(json_agg(ap.file_id order by ap.sort_order), '[]'::json) as photos
      from attendance_photos ap
     where ap.attendance_id = a.id
  ) p on true`;

const BASE_SELECT = `
  select a.*,
         s.session_date, s.start_time, s.end_time, s.subject,
         s.status as schedule_status, s.teacher_id, s.assistant_id,
         c.name  as class_name, c.level,
         sc.name as school_name, sc.code as school_code,
         mu.full_name as marked_by_name,
         coalesce(tu.full_name, s.teacher_manual_name)   as teacher_name,
         coalesce(au.full_name, s.assistant_manual_name) as assistant_name,
         p.photos
    from attendance a
    join schedules s on s.id  = a.schedule_id
    join classes c   on c.id  = a.class_id
    join schools sc  on sc.id = a.school_id
    join users mu    on mu.id = a.marked_by
    left join users tu on tu.id = s.teacher_id
    left join users au on au.id = s.assistant_id
    ${PHOTOS_LATERAL}`;

/** Một bản ghi điểm danh đầy đủ (kèm photos) — dùng cho GET /:id và phản hồi POST/PATCH. */
function fetchOne(id) {
  return one(`${BASE_SELECT} where a.id = $1`, [id]);
}

/**
 * Kiểm quyền xem MỘT bản ghi điểm danh:
 * teacher/assistant: buổi của mình hoặc chính mình điểm danh; manager: trường trong phạm vi.
 * Ngoài phạm vi ⇒ 404.
 */
async function assertRecordVisible(user, a) {
  if (user.role === 'admin') return;

  if (user.role === 'manager') {
    const ids = await visibleSchoolIds(user);
    if (ids === null || ids.includes(a.school_id)) return;
    throw notFound('Không tìm thấy bản ghi điểm danh.');
  }

  if (a.marked_by === user.id || a.teacher_id === user.id || a.assistant_id === user.id) return;
  throw notFound('Không tìm thấy bản ghi điểm danh.');
}

export default async function routes(app) {
  /* =========================================================================
   * GET /api/attendance — danh sách theo phạm vi, ?from=&to=&school_id=&class_id=
   * ======================================================================= */
  app.get('/api/attendance', async (req) => {
    const user = req.user;
    const { page, limit, offset } = paging(req.query);
    const from = dateStr(req.query.from, 'from');
    const to = dateStr(req.query.to, 'to');
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');

    const clauses = [];
    const params = [];
    let next = 1;

    if (isFieldStaff(user)) {
      // Buổi mình được phân công HOẶC chính mình điểm danh (điểm danh thay vẫn thấy được).
      clauses.push(`(a.marked_by = $${next} or s.teacher_id = $${next} or s.assistant_id = $${next})`);
      params.push(user.id);
      next += 1;
    } else {
      const f = await schoolFilter(user, 'a.school_id', next);
      clauses.push(f.sql);
      params.push(...f.params);
      next = f.next;
    }

    if (from) { clauses.push(`s.session_date >= $${next}`); params.push(from); next += 1; }
    if (to) { clauses.push(`s.session_date <= $${next}`); params.push(to); next += 1; }
    if (schoolId) { clauses.push(`a.school_id = $${next}`); params.push(schoolId); next += 1; }
    if (classId) { clauses.push(`a.class_id = $${next}`); params.push(classId); next += 1; }

    const where = clauses.join(' and ');

    const total = await scalar(
      `select count(*) from attendance a join schedules s on s.id = a.schedule_id where ${where}`,
      params
    );
    const items = await rows(
      `${BASE_SELECT}
        where ${where}
        order by s.session_date desc, s.start_time desc, a.created_at desc
        limit $${next} offset $${next + 1}`,
      [...params, limit, offset]
    );

    return { items, total: Number(total) || 0, page, limit };
  });

  /* =========================================================================
   * GET /api/attendance/pending — buổi quá giờ chưa điểm danh (dashboard PCM)
   * ======================================================================= */
  app.get(
    '/api/attendance/pending',
    { preHandler: requirePerm('attendance.viewAll') },
    async (req) => {
      const { page, limit, offset } = paging(req.query);
      const from = dateStr(req.query.from, 'from');
      const to = dateStr(req.query.to, 'to');
      const schoolId = uuid(req.query.school_id, 'school_id');

      const clauses = [];
      const params = [];
      let next = 1;

      const f = await schoolFilter(req.user, 'v.school_id', next);
      clauses.push(f.sql);
      params.push(...f.params);
      next = f.next;

      if (from) { clauses.push(`v.session_date >= $${next}`); params.push(from); next += 1; }
      if (to) { clauses.push(`v.session_date <= $${next}`); params.push(to); next += 1; }
      if (schoolId) { clauses.push(`v.school_id = $${next}`); params.push(schoolId); next += 1; }

      const where = clauses.join(' and ');

      const total = await scalar(
        `select count(*) from v_attendance_pending v where ${where}`,
        params
      );
      const items = await rows(
        `select v.schedule_id, v.school_id, v.class_id, v.session_date, v.start_time,
                v.teacher_id, v.assistant_id,
                c.name  as class_name,
                sc.name as school_name, sc.code as school_code,
                coalesce(tu.full_name, v.teacher_manual_name)   as teacher_name,
                coalesce(au.full_name, v.assistant_manual_name) as assistant_name
           from v_attendance_pending v
           join classes c   on c.id  = v.class_id
           join schools sc  on sc.id = v.school_id
           left join users tu on tu.id = v.teacher_id
           left join users au on au.id = v.assistant_id
          where ${where}
          order by v.session_date desc, v.start_time desc
          limit $${next} offset $${next + 1}`,
        [...params, limit, offset]
      );

      return { items, total: Number(total) || 0, page, limit };
    }
  );

  /* =========================================================================
   * POST /api/attendance — điểm danh một buổi (multipart, ≥1 ảnh)
   * ======================================================================= */
  app.post(
    '/api/attendance',
    { preHandler: requirePerm('attendance.submit') },
    async (req, reply) => {
      if (!req.isMultipart()) {
        throw badRequest('Yêu cầu phải gửi dạng multipart/form-data (kèm ảnh lớp học).');
      }

      // school_id chưa biết trước khi đọc fields ⇒ lưu tệp trước, gắn school_id sau.
      const { fields, files } = await consumeMultipart(req, { userId: req.user.id, allowVideo: true });
      const photos = files.photos || files['photos[]'] || [];
      if (!photos.length) throw unprocessable('Bắt buộc có ảnh tổng quan lớp học.');

      const scheduleId = uuid(fields.schedule_id, 'schedule_id', { required: true });
      const sch = await assertScheduleAccess(req.user, scheduleId);

      // teacher/assistant phải là người được phân công buổi này (assertScheduleAccess đã chặn,
      // kiểm lại tường minh). admin/manager được điểm danh thay — marked_by ghi người thật.
      const sessionRole = roleInSchedule(req.user, sch);
      if (isFieldStaff(req.user) && !sessionRole) {
        throw notFound('Không tìm thấy buổi dạy.');
      }

      if (sch.status === 'cancelled') {
        throw unprocessable('Buổi dạy đã bị huỷ, không thể điểm danh.');
      }

      const existed = await one('select id from attendance where schedule_id = $1', [scheduleId]);
      if (existed) throw conflict('Buổi này đã được điểm danh.');

      // roster_size snapshot từ lớp tại thời điểm điểm danh (đọc qua schedule, không tin client).
      const rosterSize = sch.roster_size ?? 0;
      const presentCount = int(fields.present_count, 'present_count', { required: true, min: 0 });
      if (presentCount > rosterSize + 20) {
        throw unprocessable(
          `Số học sinh có mặt (${presentCount}) vượt quá sĩ số chuẩn của lớp (${rosterSize}) quá 20 em. Vui lòng kiểm tra lại.`
        );
      }

      const absentNames = str(fields.absent_names, 'absent_names', { max: 2000 });
      const note = str(fields.note, 'note', { max: 2000 });
      const clientTime = isoTime(fields.client_time, 'client_time');
      const queuedAt = isoTime(fields.queued_at, 'queued_at');
      const syncedLate = !!queuedAt; // như timesheets: gửi từ hàng đợi offline ⇒ đồng bộ trễ

      const created = await tx(async (c) => {
        const r = await c.query(
          `insert into attendance
             (schedule_id, class_id, school_id, marked_by, roster_size, present_count,
              absent_names, note, client_time, queued_at, synced_late)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning *`,
          [
            scheduleId, sch.class_id, sch.school_id, req.user.id, rosterSize, presentCount,
            absentNames, note, clientTime, queuedAt, syncedLate,
          ]
        );
        const att = r.rows[0];

        // Ảnh theo đúng thứ tự tải lên.
        for (let i = 0; i < photos.length; i++) {
          await c.query(
            'insert into attendance_photos (attendance_id, file_id, sort_order) values ($1, $2, $3)',
            [att.id, photos[i].id, i]
          );
        }

        // Gắn school_id cho tệp để kiểm quyền xem ảnh sau này.
        await c.query('update files set school_id = $1 where id = any($2)', [
          sch.school_id,
          photos.map((f) => f.id),
        ]);

        return att;
      });

      audit(req, {
        action: 'create',
        entity: 'attendance',
        entityId: created.id,
        summary:
          `Điểm danh lớp ${sch.class_name} — ${sch.school_name} ngày ${vnDate(sch.session_date)}: ` +
          `${presentCount}/${rosterSize} học sinh có mặt` +
          (sessionRole ? '' : ' (điểm danh thay)'),
        after: { ...created, photo_ids: photos.map((f) => f.id) },
      });

      reply.code(201);
      return fetchOne(created.id);
    }
  );

  /* =========================================================================
   * GET /api/attendance/:id — chi tiết một bản ghi (kiểm phạm vi từng bản ghi)
   * ======================================================================= */
  app.get('/api/attendance/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const a = await fetchOne(id);
    if (!a) throw notFound('Không tìm thấy bản ghi điểm danh.');
    await assertRecordVisible(req.user, a);
    return a;
  });

  /* =========================================================================
   * PATCH /api/attendance/:id — người tạo trong 24h, hoặc admin/manager trong phạm vi
   * Cho sửa present_count / absent_names / note + thêm ảnh (multipart).
   * ======================================================================= */
  app.patch('/api/attendance/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await fetchOne(id);
    if (!before) throw notFound('Không tìm thấy bản ghi điểm danh.');
    await assertRecordVisible(req.user, before);

    // teacher/assistant: chỉ người tạo và trong vòng 24 giờ.
    if (isFieldStaff(req.user)) {
      const within24h = Date.now() - new Date(before.created_at).getTime() < 24 * 60 * 60 * 1000;
      if (before.marked_by !== req.user.id || !within24h) {
        throw forbidden('Chỉ người điểm danh mới được sửa, và trong vòng 24 giờ sau khi tạo.');
      }
    }

    // Nhận cả multipart (khi thêm ảnh) lẫn JSON (khi chỉ sửa chữ).
    let fields = {};
    let newPhotos = [];
    if (req.isMultipart()) {
      const parsed = await consumeMultipart(req, { userId: req.user.id, schoolId: before.school_id, allowVideo: true });
      fields = parsed.fields;
      newPhotos = parsed.files.photos || parsed.files['photos[]'] || [];
    } else {
      fields = req.body || {};
    }

    const sets = [];
    const params = [];
    let next = 1;

    if (fields.present_count !== undefined) {
      const presentCount = int(fields.present_count, 'present_count', { required: true, min: 0 });
      if (presentCount > before.roster_size + 20) {
        throw unprocessable(
          `Số học sinh có mặt (${presentCount}) vượt quá sĩ số chuẩn của lớp (${before.roster_size}) quá 20 em. Vui lòng kiểm tra lại.`
        );
      }
      sets.push(`present_count = $${next}`);
      params.push(presentCount);
      next += 1;
    }
    if (fields.absent_names !== undefined) {
      sets.push(`absent_names = $${next}`);
      params.push(str(fields.absent_names, 'absent_names', { max: 2000 }));
      next += 1;
    }
    if (fields.note !== undefined) {
      sets.push(`note = $${next}`);
      params.push(str(fields.note, 'note', { max: 2000 }));
      next += 1;
    }

    if (!sets.length && !newPhotos.length) {
      throw badRequest('Không có thay đổi nào để lưu.');
    }

    await tx(async (c) => {
      if (sets.length) {
        params.push(id);
        await c.query(`update attendance set ${sets.join(', ')} where id = $${next}`, params);
      }
      if (newPhotos.length) {
        // Ảnh mới nối tiếp sort_order hiện có.
        const base = await c.query(
          'select coalesce(max(sort_order), -1) + 1 as next_order from attendance_photos where attendance_id = $1',
          [id]
        );
        let order = base.rows[0].next_order;
        for (const f of newPhotos) {
          await c.query(
            'insert into attendance_photos (attendance_id, file_id, sort_order) values ($1, $2, $3)',
            [id, f.id, order]
          );
          order += 1;
        }
      }
    });

    const after = await fetchOne(id);

    audit(req, {
      action: 'update',
      entity: 'attendance',
      entityId: id,
      summary: `Sửa điểm danh lớp ${before.class_name} — ${before.school_name} ngày ${vnDate(before.session_date)}`,
      before,
      after,
    });

    return after;
  });

  /* =========================================================================
   * POST /api/attendance/:scheduleId/remind — nhắc người phụ trách buổi CHƯA điểm danh
   * (:id trong docs/API.md là id của SCHEDULE — buổi chưa có bản ghi attendance)
   * ======================================================================= */
  app.post(
    '/api/attendance/:scheduleId/remind',
    { preHandler: requirePerm('attendance.viewAll') },
    async (req, reply) => {
      const scheduleId = uuid(req.params.scheduleId, 'schedule_id', { required: true });
      const sch = await assertScheduleAccess(req.user, scheduleId);

      const existed = await one('select id from attendance where schedule_id = $1', [scheduleId]);
      if (existed) throw conflict('Buổi này đã điểm danh rồi.');

      const targets = [sch.teacher_id, sch.assistant_id].filter(Boolean);
      if (!targets.length) {
        throw unprocessable('Buổi dạy chưa được phân công người phụ trách để nhắc.');
      }

      await notify(targets, {
        kind: 'attendance_missing',
        title: 'Nhắc điểm danh lớp học',
        body:
          `Buổi ${sch.subject ? `"${sch.subject}" — ` : ''}lớp ${sch.class_name} (${sch.school_name}) ` +
          `ngày ${vnDate(sch.session_date)} chưa được điểm danh. Vui lòng điểm danh ngay.`,
        link: `/diem-danh/${scheduleId}`,
        refId: scheduleId,
      });

      return reply.code(204).send();
    }
  );
}
