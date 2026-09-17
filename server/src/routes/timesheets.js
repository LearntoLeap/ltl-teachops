/**
 * routes/timesheets.js — Chấm công GPS: check-in / check-out, duyệt, sửa tay, đối chiếu.
 *
 * Đây là module NHẠY CẢM NHẤT hệ thống — dữ liệu ở đây là nền của bảng lương:
 *   - Mọi mốc thời gian nghiệp vụ dùng GIỜ SERVER (client_time/queued_at chỉ để tham chiếu).
 *   - Ngoài bán kính GPS ⇒ bắt buộc ghi chú + gps_flagged + chờ Phòng chuyên môn duyệt.
 *   - Mọi thao tác ghi đều để lại vết trong audit_log.
 * Tham chiếu: docs/API.md §5, docs/ARCHITECTURE.md §5.1.
 */
import { one, rows, scalar, tx, query } from '../db.js';
import { badRequest, forbidden, notFound, conflict, unprocessable } from '../lib/errors.js';
import { requirePerm, isFieldStaff } from '../lib/rbac.js';
import { schoolFilter, assertSchoolAccess, visibleSchoolIds } from '../lib/scope.js';
import { str, uuid, int, num, bool, enumOf, dateStr, isoTime, paging, dateRange } from '../lib/validate.js';
import { distanceMeters, isValidCoord, labelCheckIn, workMinutes } from '../lib/geo.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';

const LABELS = ['ontime', 'late', 'absent'];
const APPROVALS = ['pending', 'approved', 'rejected'];
const SYNC_LATE_MS = 10 * 60_000; // đồng bộ offline trễ quá 10 phút ⇒ synced_late

const SESSIONS = ['morning', 'afternoon'];
const SESSION_VN = { morning: 'buổi sáng', afternoon: 'buổi chiều' };

/** Hôm nay theo giờ Việt Nam ('YYYY-MM-DD') — mốc nghiệp vụ của chấm công. */
function vnToday() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Đang là buổi sáng hay chiều theo giờ Việt Nam (mốc 12:00). */
function vnSessionNow() {
  return new Date(Date.now() + 7 * 3600_000).getUTCHours() < 12 ? 'morning' : 'afternoon';
}

/**
 * Lịch dạy của buổi đó — CHỈ để nhắc giờ và tính "đến đúng giờ chưa".
 * Chấm công không thuộc về tiết nào; tiết đầu buổi chỉ cho biết mấy giờ phải có mặt.
 */
async function plannedShift(userId, schoolId, date, session) {
  const first = await one(
    `select s.id, s.start_time, count(*) over () ::int as periods
       from schedules s
      where s.school_id = $1 and s.session_date = $2 and s.status <> 'cancelled'
        and (s.teacher_id = $3 or s.assistant_id = $3)
        and (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session = $4
      order by s.start_time limit 1`,
    [schoolId, date, userId, session]
  );
  return {
    schedule_id: first?.id ?? null,
    start_time: first ? String(first.start_time).slice(0, 5) : null,
    periods: first?.periods ?? 0,
  };
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' cho nội dung thông báo/nhật ký. */
function vnDate(d) {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

/**
 * Gắn school_id cho các tệp vừa lưu. consumeMultipart chạy TRƯỚC khi biết buổi
 * thuộc trường nào (schedule_id nằm trong fields), nên bổ sung phạm vi tại đây
 * để route /api/files kiểm quyền xem đúng.
 */
async function tagFilesSchool(files, schoolId) {
  const ids = Object.values(files || {}).flat().map((f) => f.id);
  if (!ids.length || !schoolId) return;
  await query('update files set school_id = $1 where id = any($2::uuid[])', [schoolId, ids]);
}

/**
 * Thời điểm ISO chặt chẽ cho sửa tay — khác isoTime: sai định dạng phải báo lỗi
 * (không được lặng lẽ bỏ qua khi Admin sửa dữ liệu lương).
 * undefined = không gửi trường này; null/'' = xoá giá trị.
 */
function strictIso(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} không phải thời điểm hợp lệ (ISO 8601).`);
  return d.toISOString();
}

export default async function routes(app) {
  /* =========================================================================
   * GET /api/timesheets — danh sách theo phạm vi
   *   teacher/assistant: chỉ của mình (bỏ qua ?user_id).
   *   admin/manager: phạm vi trường + ?user_id=&school_id=&label=&approval_status=&from=&to=
   * ======================================================================= */
  app.get('/api/timesheets', async (req) => {
    const user = req.user;
    const q = req.query || {};
    const { page, limit, offset } = paging(q);

    const label = enumOf(q.label, 'label', LABELS);
    const approval = enumOf(q.approval_status, 'approval_status', APPROVALS);
    const from = dateStr(q.from, 'from');
    const to = dateStr(q.to, 'to');
    const schoolId = uuid(q.school_id, 'school_id');

    const params = [];
    const conds = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    if (isFieldStaff(user)) {
      // GV/TG chỉ xem chấm công của chính mình — bỏ qua ?user_id client gửi lên.
      conds.push(`t.user_id = ${p(user.id)}`);
    } else {
      const f = await schoolFilter(user, 't.school_id', params.length + 1);
      conds.push(f.sql);
      params.push(...f.params);
      const userId = uuid(q.user_id, 'user_id');
      if (userId) conds.push(`t.user_id = ${p(userId)}`);
    }
    if (schoolId) conds.push(`t.school_id = ${p(schoolId)}`);
    if (label) conds.push(`t.label = ${p(label)}`);
    if (approval) conds.push(`t.approval_status = ${p(approval)}`);
    if (from) conds.push(`t.work_date >= ${p(from)}`);
    if (to) conds.push(`t.work_date <= ${p(to)}`);

    // Chấm công thuộc về (người, ngày, buổi, trường) — không còn đi qua tiết nào.
    const baseSql = `
        from timesheets t
        join schools sc on sc.id = t.school_id
        join users u on u.id = t.user_id
       where ${conds.join(' and ')}`;

    const total = Number(await scalar(`select count(*) ${baseSql}`, params)) || 0;
    const items = await rows(
      `select t.*, sc.name as school_name, u.full_name as user_name,
              (select count(*) from schedules s
                where s.school_id = t.school_id and s.session_date = t.work_date
                  and s.status <> 'cancelled'
                  and (s.teacher_id = t.user_id or s.assistant_id = t.user_id)
                  and (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session
                      = t.work_session)::int as planned_periods
         ${baseSql}
        order by t.work_date desc, t.work_session, sc.name
        limit ${p(limit)} offset ${p(offset)}`,
      params
    );
    return { items, total, page, limit };
  });

  /* =========================================================================
   * GET /api/timesheets/reconcile — đối chiếu kế hoạch ↔ thực tế (nền bảng lương)
   * ======================================================================= */
  app.get('/api/timesheets/reconcile', { preHandler: requirePerm('timesheet.viewAll') }, async (req) => {
    const q = req.query || {};
    const { page, limit, offset } = paging(q);
    const { from, to } = dateRange(q); // mặc định tháng hiện tại — không quét vô hạn
    const schoolId = uuid(q.school_id, 'school_id');
    const userId = uuid(q.user_id, 'user_id');

    const params = [];
    const conds = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    const f = await schoolFilter(req.user, 'v.school_id', 1);
    conds.push(f.sql);
    params.push(...f.params);

    conds.push(`v.work_date >= ${p(from)}`);
    conds.push(`v.work_date <= ${p(to)}`);
    if (schoolId) conds.push(`v.school_id = ${p(schoolId)}`);
    if (userId) conds.push(`v.user_id = ${p(userId)}`);

    const baseSql = ` from v_work_shifts v where ${conds.join(' and ')}`;

    const total = Number(await scalar(`select count(*)${baseSql}`, params)) || 0;
    // Tổng hợp trên TOÀN BỘ tập lọc (không chỉ trang hiện tại).
    const summary = await one(
      `select count(*)::int                                          as total_shifts,
              count(*) filter (where v.label = 'ontime')::int        as ontime,
              count(*) filter (where v.label = 'late')::int          as late,
              count(*) filter (where v.label = 'absent')::int        as absent,
              count(*) filter (where v.gps_flagged)::int             as flagged,
              coalesce(sum(v.late_minutes), 0)::int                  as total_late_minutes,
              coalesce(sum(v.work_minutes), 0)::int                  as total_work_minutes
        ${baseSql}`,
      params
    );

    const items = await rows(
      `select v.*${baseSql}
        order by v.work_date desc, v.work_session, v.school_name, v.full_name
        limit ${p(limit)} offset ${p(offset)}`,
      params
    );
    return { items, total, page, limit, summary };
  });

  /* =========================================================================
   * GET /api/timesheets/my-shift — trạng thái chấm công BUỔI của tôi
   *   ?school_id= (bắt buộc) &date=YYYY-MM-DD &session=morning|afternoon
   *   Không gửi date/session ⇒ lấy theo giờ Việt Nam hiện tại.
   * ======================================================================= */
  app.get('/api/timesheets/my-shift', { preHandler: requirePerm('timesheet.self') }, async (req) => {
    const schoolId = uuid(req.query.school_id, 'school_id', { required: true });
    const school = await assertSchoolAccess(req.user, schoolId);
    const date = dateStr(req.query.date, 'date') || vnToday();
    const session = enumOf(req.query.session, 'session', SESSIONS) || vnSessionNow();

    const item = await one(
      `select * from timesheets
        where user_id = $1 and school_id = $2 and work_date = $3 and work_session = $4`,
      [req.user.id, schoolId, date, session]
    );
    const planned = await plannedShift(req.user.id, schoolId, date, session);

    return {
      item,                      // null = chưa chấm công buổi này
      date,
      session,
      school: { id: school.id, name: school.name, gps_radius_m: school.gps_radius_m },
      planned,                   // { start_time, periods } — lịch dạy chỉ để NHẮC giờ
    };
  });

  /* =========================================================================
   * POST /api/timesheets/check-in — multipart. CHẤM CÔNG ĐẦU BUỔI.
   *
   * Một lần cho cả buổi (sáng/chiều), KHÔNG gắn với tiết nào. Kèm kiểm thiết bị
   * đầu buổi. Lịch dạy chỉ dùng để biết giờ dự kiến có mặt ⇒ tính đúng giờ/trễ.
   * ======================================================================= */
  app.post('/api/timesheets/check-in', { preHandler: requirePerm('timesheet.self') }, async (req, reply) => {
    const user = req.user;
    const { fields, files } = await consumeMultipart(req, { userId: user.id });

    const schoolId = uuid(fields.school_id, 'school_id', { required: true });
    const school = await assertSchoolAccess(user, schoolId);
    await tagFilesSchool(files, schoolId);

    const date = dateStr(fields.date, 'date') || vnToday();
    const session = enumOf(fields.session, 'session', SESSIONS) || vnSessionNow();

    const existing = await one(
      `select id, check_in_at from timesheets
        where user_id = $1 and school_id = $2 and work_date = $3 and work_session = $4`,
      [user.id, schoolId, date, session]
    );
    if (existing?.check_in_at) {
      throw conflict(`Bạn đã chấm công ${SESSION_VN[session]} hôm nay ở ${school.name} rồi.`);
    }

    // GPS bắt buộc — đây là bằng chứng có mặt tại trường.
    const lat = num(fields.lat, 'lat', { min: -90, max: 90 });
    const lng = num(fields.lng, 'lng', { min: -180, max: 180 });
    const accuracy = num(fields.accuracy, 'accuracy', { min: 0, max: 1_000_000 });
    if (!isValidCoord(lat, lng)) {
      throw badRequest('Không nhận được toạ độ GPS hợp lệ. Vui lòng bật định vị rồi thử lại.');
    }

    // Ảnh thiết bị đầu buổi + selfie xác minh đúng người.
    const photo = files.photo?.[0];
    if (!photo) throw unprocessable('Bắt buộc chụp ảnh thiết bị đầu buổi.');
    const selfie = files.selfie?.[0];
    if (!selfie) throw unprocessable('Bắt buộc chụp ảnh selfie tại trường để xác minh.');
    const deviceCount = int(fields.device_count, 'device_count', { required: true, min: 0, max: 100_000 });
    const note = str(fields.note, 'note', { max: 2000 });

    // Đối chiếu vị trí với toạ độ trường.
    let distance = null;
    let gpsFlagged = false;
    let approvalStatus = 'approved';
    let autoNote = null;

    if (isValidCoord(school.lat, school.lng)) {
      distance = distanceMeters(lat, lng, school.lat, school.lng);
      if (distance > school.gps_radius_m) {
        if (!note) {
          throw unprocessable(
            `Bạn đang cách trường ${distance}m — ngoài bán kính cho phép ${school.gps_radius_m}m. Vui lòng ghi rõ lý do.`
          );
        }
        gpsFlagged = true;
        approvalStatus = 'pending';
      }
    } else {
      autoNote = '[Hệ thống] Trường chưa cấu hình toạ độ GPS.';
    }

    // Giờ dự kiến = tiết đầu tiên của buổi theo lịch. Không có lịch ⇒ vẫn chấm
    // công được, nhưng đánh dấu để Phòng chuyên môn soát lại.
    const planned = await plannedShift(user.id, schoolId, date, session);
    const checkInAt = new Date();
    const { lateMinutes, label } = planned.start_time
      ? labelCheckIn(checkInAt, date, planned.start_time, school.grace_minutes)
      : { lateMinutes: 0, label: 'ontime' };
    if (!planned.start_time) {
      autoNote = [autoNote, '[Hệ thống] Buổi này không có tiết nào trong lịch dạy.'].filter(Boolean).join(' — ');
    }
    const checkInNote = [note, autoNote].filter(Boolean).join(' — ') || null;

    const clientTime = isoTime(fields.client_time, 'client_time');
    const queuedAt = isoTime(fields.queued_at, 'queued_at');
    const syncedLate = !!(queuedAt && checkInAt.getTime() - new Date(queuedAt).getTime() > SYNC_LATE_MS);
    const sessionRole = user.role === 'assistant' ? 'assistant' : 'teacher';

    const saved = await one(
      `insert into timesheets
         (user_id, school_id, work_date, work_session, schedule_id, role,
          planned_start_time, unscheduled,
          check_in_at, check_in_lat, check_in_lng, check_in_accuracy, check_in_distance_m,
          check_in_photo_id, check_in_selfie_id, check_in_device_count, check_in_note,
          gps_flagged, late_minutes, label, approval_status, client_time, queued_at, synced_late)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       on conflict (user_id, work_date, work_session, school_id) do update set
         schedule_id           = excluded.schedule_id,
         role                  = excluded.role,
         planned_start_time    = excluded.planned_start_time,
         unscheduled           = excluded.unscheduled,
         check_in_at           = excluded.check_in_at,
         check_in_lat          = excluded.check_in_lat,
         check_in_lng          = excluded.check_in_lng,
         check_in_accuracy     = excluded.check_in_accuracy,
         check_in_distance_m   = excluded.check_in_distance_m,
         check_in_photo_id     = excluded.check_in_photo_id,
         check_in_selfie_id    = excluded.check_in_selfie_id,
         check_in_device_count = excluded.check_in_device_count,
         check_in_note         = excluded.check_in_note,
         gps_flagged           = excluded.gps_flagged,
         late_minutes          = excluded.late_minutes,
         label                 = excluded.label,
         approval_status       = excluded.approval_status,
         client_time           = excluded.client_time,
         queued_at             = excluded.queued_at,
         synced_late           = excluded.synced_late
       where timesheets.check_in_at is null
       returning *`,
      [user.id, schoolId, date, session, planned.schedule_id, sessionRole,
       planned.start_time, !planned.start_time,
       checkInAt, lat, lng, accuracy, distance,
       photo.id, selfie.id, deviceCount, checkInNote,
       gpsFlagged, lateMinutes, label, approvalStatus, clientTime, queuedAt, syncedLate]
    );
    if (!saved) throw conflict('Bạn đã chấm công buổi này rồi.');

    audit(req, {
      action: 'create',
      entity: 'timesheets',
      entityId: saved.id,
      summary: `Chấm công vào ${SESSION_VN[session]} — ${school.name} ngày ${vnDate(date)}, `
        + `${label === 'late' ? `trễ ${lateMinutes} phút` : 'đúng giờ'}`
        + `${gpsFlagged ? ' (ngoài bán kính GPS)' : ''}.`,
      after: saved,
    });

    if (gpsFlagged) {
      notifySchoolManagers(schoolId, {
        kind: 'timesheet_flagged',
        title: 'Chấm công ngoài bán kính GPS',
        body: `${user.full_name} chấm công vào cách trường ${school.name} ${distance}m `
          + `(cho phép ${school.gps_radius_m}m) — ${SESSION_VN[session]} ngày ${vnDate(date)}.`,
        link: '/cham-cong?duyet=1',
        refId: saved.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo timesheet_flagged'));
    }

    reply.code(201);
    return { ...saved, distance_m: saved.check_in_distance_m, planned };
  });

  /* =========================================================================
   * POST /api/timesheets/check-out — multipart. CHẤM CÔNG CUỐI BUỔI.
   * Kèm kiểm thiết bị cuối buổi; có hỏng thì tự mở phiếu báo hỏng.
   * ======================================================================= */
  app.post('/api/timesheets/check-out', { preHandler: requirePerm('timesheet.self') }, async (req) => {
    const user = req.user;
    const { fields, files } = await consumeMultipart(req, { userId: user.id });

    const schoolId = uuid(fields.school_id, 'school_id', { required: true });
    const school = await assertSchoolAccess(user, schoolId);
    await tagFilesSchool(files, schoolId);

    const date = dateStr(fields.date, 'date') || vnToday();
    const session = enumOf(fields.session, 'session', SESSIONS) || vnSessionNow();

    const ts = await one(
      `select * from timesheets
        where user_id = $1 and school_id = $2 and work_date = $3 and work_session = $4`,
      [user.id, schoolId, date, session]
    );
    if (!ts || !ts.check_in_at) throw unprocessable(`Bạn chưa chấm công vào ${SESSION_VN[session]} hôm nay.`);
    if (ts.check_out_at) throw conflict(`Bạn đã chấm công ra ${SESSION_VN[session]} rồi.`);

    const deviceOk = bool(fields.device_ok, 'device_ok', { required: true });
    const damageNote = str(fields.damage_note, 'damage_note', { max: 2000 });
    const note = str(fields.note, 'note', { max: 2000 });
    const lat = num(fields.lat, 'lat', { min: -90, max: 90 });
    const lng = num(fields.lng, 'lng', { min: -180, max: 180 });
    const hasCoord = isValidCoord(lat, lng);
    const distance = hasCoord && isValidCoord(school.lat, school.lng)
      ? distanceMeters(lat, lng, school.lat, school.lng)
      : null;

    const damagePhotos = files.damage_photo || [];
    if (deviceOk === false && (!damageNote || !damagePhotos.length)) {
      throw unprocessable('Có thiết bị hỏng: bắt buộc mô tả và chụp ảnh minh chứng.');
    }

    const checkOutAt = new Date();
    const minutes = workMinutes(ts.check_in_at, checkOutAt);
    const clientTime = isoTime(fields.client_time, 'client_time');
    const queuedAt = isoTime(fields.queued_at, 'queued_at');
    const syncedLate = !!(queuedAt && checkOutAt.getTime() - new Date(queuedAt).getTime() > SYNC_LATE_MS);
    const photoId = files.photo?.[0]?.id || null;

    // Phòng STEM của tiết đầu buổi — để phiếu báo hỏng chỉ đúng chỗ.
    const room = await one(
      `select s.room_id, r.name as room_name from schedules s
         left join stem_rooms r on r.id = s.room_id
        where s.school_id = $1 and s.session_date = $2 and s.status <> 'cancelled'
          and (s.teacher_id = $3 or s.assistant_id = $3)
          and (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session = $4
        order by s.start_time limit 1`,
      [schoolId, date, user.id, session]
    );

    const { saved, issue } = await tx(async (c) => {
      const r = await c.query(
        `update timesheets set
           check_out_at = $1, check_out_lat = $2, check_out_lng = $3, check_out_distance_m = $4,
           check_out_photo_id = $5, device_ok = $6, damage_note = $7, check_out_note = $8,
           work_minutes = $9,
           client_time  = coalesce($10, client_time),
           queued_at    = coalesce($11, queued_at),
           synced_late  = synced_late or $12
         where id = $13 and check_out_at is null
         returning *`,
        [checkOutAt, hasCoord ? lat : null, hasCoord ? lng : null, distance,
         photoId, deviceOk, deviceOk === false ? damageNote : null, note,
         minutes, clientTime, queuedAt, syncedLate, ts.id]
      );
      const savedRow = r.rows[0];
      if (!savedRow) throw conflict('Bạn đã chấm công ra buổi này rồi.');

      let issueRow = null;
      if (deviceOk === false) {
        const ir = await c.query(
          `insert into device_issues
             (school_id, room_id, device_name, description, priority, status, source, source_id, reported_by)
           values ($1, $2, $3, $4, 'high', 'new', 'checkout', $5, $6)
           returning *`,
          [schoolId, room?.room_id ?? null,
           `Thiết bị ${room?.room_name ? `phòng ${room.room_name}` : `${school.name}`}`,
           damageNote, savedRow.id, user.id]
        );
        issueRow = ir.rows[0];
        for (let i = 0; i < damagePhotos.length; i++) {
          await c.query(
            'insert into device_issue_photos (issue_id, file_id, sort_order) values ($1, $2, $3)',
            [issueRow.id, damagePhotos[i].id, i]
          );
        }
      }
      return { saved: savedRow, issue: issueRow };
    });

    audit(req, {
      action: 'update',
      entity: 'timesheets',
      entityId: saved.id,
      summary: `Chấm công ra ${SESSION_VN[session]} — ${school.name} ngày ${vnDate(date)} `
        + `(${minutes} phút làm việc)${deviceOk === false ? ', có thiết bị hỏng' : ''}.`,
      before: ts,
      after: saved,
    });

    if (issue) {
      notifySchoolManagers(schoolId, {
        kind: 'device_issue',
        title: 'Thiết bị hỏng cuối buổi',
        body: `${user.full_name} báo hỏng thiết bị tại ${school.name}: ${damageNote}`,
        link: '/thiet-bi',
        refId: issue.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo device_issue'));
    }

    return { ...saved, device_issue_id: issue ? issue.id : null };
  });

  /* =========================================================================
   * POST /api/timesheets/:id/approve — duyệt / từ chối bản ghi gps_flagged
   * ======================================================================= */
  app.post('/api/timesheets/:id/approve', { preHandler: requirePerm('timesheet.approve') }, async (req) => {
    const user = req.user;
    const id = uuid(req.params.id, 'id', { required: true });
    const b = req.body || {};
    const decision = enumOf(b.decision, 'decision', ['approved', 'rejected'], { required: true });
    const reason = str(b.reason, 'reason', { max: 2000 });
    if (decision === 'rejected' && !reason) {
      throw unprocessable('Từ chối chấm công bắt buộc phải ghi rõ lý do.');
    }

    const before = await one(
      `select t.*, sc.name as school_name, u.full_name as user_name
         from timesheets t
         join schools sc on sc.id = t.school_id
         join users u on u.id = t.user_id
        where t.id = $1`,
      [id]
    );
    if (!before) throw notFound('Không tìm thấy bản ghi chấm công.');

    // Manager chỉ duyệt trong phạm vi trường phụ trách — ngoài phạm vi trả 404, không lộ sự tồn tại.
    const visibleIds = await visibleSchoolIds(user);
    if (visibleIds !== null && !visibleIds.includes(before.school_id)) {
      throw notFound('Không tìm thấy bản ghi chấm công.');
    }

    const saved = await one(
      `update timesheets
          set approval_status = $1, approved_by = $2, approved_at = now(), reject_reason = $3
        where id = $4
        returning *`,
      [decision, user.id, decision === 'rejected' ? reason : null, id]
    );

    audit(req, {
      action: decision === 'approved' ? 'approve' : 'reject',
      entity: 'timesheets',
      entityId: id,
      summary: `${decision === 'approved' ? 'Duyệt' : 'Từ chối'} chấm công của ${before.user_name} — ` +
               `${SESSION_VN[before.work_session]} ${before.school_name} ngày ${vnDate(before.work_date)}.`,
      before: {
        approval_status: before.approval_status,
        approved_by: before.approved_by,
        approved_at: before.approved_at,
        reject_reason: before.reject_reason,
      },
      after: {
        approval_status: saved.approval_status,
        approved_by: saved.approved_by,
        approved_at: saved.approved_at,
        reject_reason: saved.reject_reason,
      },
    });

    // Báo cho người dạy biết kết quả.
    notify(before.user_id, {
      kind: 'timesheet_reviewed',
      title: decision === 'approved' ? 'Chấm công đã được duyệt' : 'Chấm công bị từ chối',
      body: decision === 'approved'
        ? `Chấm công ${SESSION_VN[before.work_session]} ngày ${vnDate(before.work_date)} đã được xác nhận.`
        : `Chấm công ${SESSION_VN[before.work_session]} ngày ${vnDate(before.work_date)} bị từ chối — lý do: ${reason}`,
      link: '/cham-cong',
      refId: id,
    }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo timesheet_reviewed'));

    return saved;
  });

  /* =========================================================================
   * PATCH /api/timesheets/:id — Admin sửa tay (bắt buộc audit before/after)
   * ======================================================================= */
  app.patch('/api/timesheets/:id', { preHandler: requirePerm('timesheet.edit') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const b = req.body || {};

    const before = await one(
      `select t.*, u.full_name as user_name, sc.name as school_name
         from timesheets t
         join users u on u.id = t.user_id
         join schools sc on sc.id = t.school_id
        where t.id = $1`,
      [id]
    );
    if (!before) throw notFound('Không tìm thấy bản ghi chấm công.');

    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const newIn = strictIso(b.check_in_at, 'check_in_at');
    const newOut = strictIso(b.check_out_at, 'check_out_at');
    if (newIn !== undefined) set('check_in_at', newIn);
    if (newOut !== undefined) set('check_out_at', newOut);

    if ('label' in b) set('label', enumOf(b.label, 'label', LABELS, { required: true }));
    if ('late_minutes' in b) set('late_minutes', int(b.late_minutes, 'late_minutes', { required: true, min: 0, max: 100_000 }));
    if ('approval_status' in b) set('approval_status', enumOf(b.approval_status, 'approval_status', APPROVALS, { required: true }));
    if ('check_in_note' in b) set('check_in_note', str(b.check_in_note, 'check_in_note', { max: 2000 }));
    if ('check_out_note' in b) set('check_out_note', str(b.check_out_note, 'check_out_note', { max: 2000 }));

    // Đổi giờ ⇒ TÍNH LẠI work_minutes (trừ khi Admin tự truyền giá trị tường minh).
    if ('work_minutes' in b) {
      set('work_minutes', int(b.work_minutes, 'work_minutes', { min: 0, max: 100_000 }));
    } else if (newIn !== undefined || newOut !== undefined) {
      const effIn = newIn !== undefined ? newIn : before.check_in_at;
      const effOut = newOut !== undefined ? newOut : before.check_out_at;
      set('work_minutes', effIn && effOut ? workMinutes(effIn, effOut) : null);
    }

    if (!sets.length) throw badRequest('Không có dữ liệu nào để cập nhật.');

    params.push(id);
    const saved = await one(
      `update timesheets set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );

    // BẮT BUỘC before/after — đây là dữ liệu tính lương.
    audit(req, {
      action: 'update',
      entity: 'timesheets',
      entityId: id,
      summary: `Sửa tay chấm công của ${before.user_name} — ${SESSION_VN[before.work_session]}, ` +
               `${before.school_name} ngày ${vnDate(before.work_date)}.`,
      before,
      after: saved,
    });

    return saved;
  });
}
