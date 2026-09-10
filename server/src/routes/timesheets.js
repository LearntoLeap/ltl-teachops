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
import { schoolFilter, assertScheduleAccess, roleInSchedule, visibleSchoolIds } from '../lib/scope.js';
import { str, uuid, int, num, bool, enumOf, dateStr, isoTime, paging, dateRange } from '../lib/validate.js';
import { distanceMeters, isValidCoord, labelCheckIn, workMinutes } from '../lib/geo.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';

const LABELS = ['ontime', 'late', 'absent'];
const APPROVALS = ['pending', 'approved', 'rejected'];
const SYNC_LATE_MS = 10 * 60_000; // đồng bộ offline trễ quá 10 phút ⇒ synced_late

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
      const f = await schoolFilter(user, 's.school_id', params.length + 1);
      conds.push(f.sql);
      params.push(...f.params);
      const userId = uuid(q.user_id, 'user_id');
      if (userId) conds.push(`t.user_id = ${p(userId)}`);
    }
    if (schoolId) conds.push(`s.school_id = ${p(schoolId)}`);
    if (label) conds.push(`t.label = ${p(label)}`);
    if (approval) conds.push(`t.approval_status = ${p(approval)}`);
    if (from) conds.push(`s.session_date >= ${p(from)}`);
    if (to) conds.push(`s.session_date <= ${p(to)}`);

    const baseSql = `
        from timesheets t
        join schedules s on s.id = t.schedule_id
        join schools sc on sc.id = s.school_id
        join classes c on c.id = s.class_id
        join users u on u.id = t.user_id
       where ${conds.join(' and ')}`;

    const total = Number(await scalar(`select count(*) ${baseSql}`, params)) || 0;
    const items = await rows(
      `select t.*, s.session_date, s.start_time, s.end_time, s.subject,
              s.status as schedule_status, s.school_id, s.class_id,
              sc.name as school_name, c.name as class_name, u.full_name as user_name
         ${baseSql}
        order by s.session_date desc, s.start_time, sc.name
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

    conds.push(`v.session_date >= ${p(from)}`);
    conds.push(`v.session_date <= ${p(to)}`);
    if (schoolId) conds.push(`v.school_id = ${p(schoolId)}`);
    if (userId) conds.push(`v.user_id = ${p(userId)}`);

    const baseSql = ` from v_timesheet_reconcile v where ${conds.join(' and ')}`;

    const total = Number(await scalar(`select count(*)${baseSql}`, params)) || 0;
    // Tổng hợp trên TOÀN BỘ tập lọc (không chỉ trang hiện tại).
    const summary = await one(
      `select count(*)::int                                          as total_sessions,
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
        order by v.session_date desc, v.start_time, v.school_name, v.class_name
        limit ${p(limit)} offset ${p(offset)}`,
      params
    );
    return { items, total, page, limit, summary };
  });

  /* =========================================================================
   * GET /api/timesheets/my/:schedule_id — trạng thái chấm công của tôi cho buổi đó
   * ======================================================================= */
  app.get('/api/timesheets/my/:schedule_id', { preHandler: requirePerm('timesheet.self') }, async (req) => {
    const scheduleId = uuid(req.params.schedule_id, 'schedule_id', { required: true });
    const sch = await assertScheduleAccess(req.user, scheduleId);
    const item = await one(
      'select * from timesheets where schedule_id = $1 and user_id = $2',
      [sch.id, req.user.id]
    );

    // Tiết nối tiếp? — đã check-in một tiết khác CÙNG buổi (sáng/chiều) cùng
    // trường hôm đó ⇒ client hiện form rút gọn (không GPS/ảnh bắt buộc).
    const block = String(sch.start_time) < '12:00:00' ? 'morning' : 'afternoon';
    const first = await one(
      `select t.id from timesheets t
         join schedules s2 on s2.id = t.schedule_id
        where t.user_id = $1 and t.check_in_at is not null
          and s2.school_id = $2 and s2.session_date = $3 and s2.id <> $4
          and (case when s2.start_time < '12:00:00' then 'morning' else 'afternoon' end) = $5
        limit 1`,
      [req.user.id, sch.school_id, sch.session_date, sch.id, block]
    );

    return { item, block_checked_in: !!first }; // item = null nếu chưa chấm công
  });

  /* =========================================================================
   * POST /api/timesheets/check-in — multipart
   * ======================================================================= */
  app.post('/api/timesheets/check-in', { preHandler: requirePerm('timesheet.self') }, async (req, reply) => {
    const user = req.user;

    // 1. Nhận multipart trước (schedule_id nằm trong fields nên chưa biết trường nào).
    const { fields, files } = await consumeMultipart(req, { userId: user.id });

    // 2. Buổi dạy + vai trò trong buổi — CHỈ người được phân công mới check-in,
    //    admin/manager không check-in hộ.
    const scheduleId = uuid(fields.schedule_id, 'schedule_id', { required: true });
    const sch = await assertScheduleAccess(user, scheduleId);
    const role = roleInSchedule(user, sch);
    if (!role) throw forbidden('Bạn không được phân công buổi này.');
    await tagFilesSchool(files, sch.school_id);

    // 3. Buổi đã huỷ thì không chấm công.
    if (sch.status === 'cancelled') throw unprocessable('Buổi này đã huỷ.');

    // 4. Chặn check-in trùng.
    const existing = await one(
      'select id, check_in_at from timesheets where schedule_id = $1 and user_id = $2',
      [sch.id, user.id]
    );
    if (existing?.check_in_at) throw conflict('Bạn đã check-in buổi này rồi.');

    // 4b. TIẾT NỐI TIẾP: đã check-in một tiết TRƯỚC ĐÓ trong cùng buổi
    //     (sáng/chiều) cùng trường cùng ngày ⇒ các tiết sau chỉ cần cập nhật
    //     số thiết bị (GPS + ảnh không bắt buộc) — theo quy trình vận hành LtL.
    const block = String(sch.start_time) < '12:00:00' ? 'morning' : 'afternoon';
    const linkedFirst = await one(
      `select t.id, t.check_in_at from timesheets t
         join schedules s2 on s2.id = t.schedule_id
        where t.user_id = $1 and t.check_in_at is not null
          and s2.school_id = $2 and s2.session_date = $3 and s2.id <> $4
          and (case when s2.start_time < '12:00:00' then 'morning' else 'afternoon' end) = $5
        order by t.check_in_at asc limit 1`,
      [user.id, sch.school_id, sch.session_date, sch.id, block]
    );

    // 5. Toạ độ GPS: bắt buộc với tiết ĐẦU buổi; tiết nối tiếp thì tuỳ chọn.
    const lat = num(fields.lat, 'lat', { min: -90, max: 90 });
    const lng = num(fields.lng, 'lng', { min: -180, max: 180 });
    const accuracy = num(fields.accuracy, 'accuracy', { min: 0, max: 1_000_000 });
    const hasCoord = isValidCoord(lat, lng);
    if (!hasCoord && !linkedFirst) {
      throw badRequest('Không nhận được toạ độ GPS hợp lệ. Vui lòng bật định vị rồi thử lại.');
    }

    // 6. Ảnh thiết bị + số thiết bị: ảnh bắt buộc với tiết đầu buổi.
    const photo = files.photo?.[0];
    if (!photo && !linkedFirst) throw unprocessable('Bắt buộc chụp ảnh thiết bị đầu buổi.');
    const deviceCount = int(fields.device_count, 'device_count', { required: true, min: 0, max: 100_000 });
    const note = str(fields.note, 'note', { max: 2000 });

    // 7. Khoảng cách tới trường + cờ GPS.
    let distance = null;
    let gpsFlagged = false;
    let approvalStatus = 'approved';
    let autoNote = null;

    if (hasCoord && isValidCoord(sch.school_lat, sch.school_lng)) {
      distance = distanceMeters(lat, lng, sch.school_lat, sch.school_lng);
    }
    if (linkedFirst) {
      // Tiết nối tiếp: đã xác minh vị trí ở tiết đầu buổi — không đối chiếu lại.
      autoNote = '[Hệ thống] Tiết nối tiếp trong buổi — vị trí đã xác minh ở tiết đầu.';
    } else if (distance === null) {
      // Trường chưa cấu hình toạ độ ⇒ không đối chiếu được, KHÔNG gắn cờ —
      // chỉ ghi chú tự động để Phòng chuyên môn/kế toán biết.
      autoNote = '[Hệ thống] Trường chưa cấu hình toạ độ GPS.';
    } else if (distance > sch.gps_radius_m) {
      if (!note) {
        throw unprocessable(
          `Bạn đang cách trường ${distance}m — ngoài bán kính cho phép ${sch.gps_radius_m}m. Vui lòng ghi rõ lý do.`
        );
      }
      gpsFlagged = true;
      approvalStatus = 'pending'; // chờ Phòng chuyên môn duyệt tay
    }
    const checkInNote = [note, autoNote].filter(Boolean).join(' — ') || null;

    // 8. Nhãn giờ tính bằng GIỜ SERVER so với lịch (grace_minutes theo từng trường).
    const checkInAt = new Date();
    const { lateMinutes, label } = labelCheckIn(checkInAt, sch.session_date, sch.start_time, sch.grace_minutes);

    // 9. Ghi bản ghi — upsert theo unique(schedule_id, user_id): nếu job cuối ngày đã tạo
    //    bản ghi 'absent' (chưa check-in) thì cập nhật đè lên chính bản ghi đó.
    //    Điều kiện "check_in_at is null" chặn luôn race hai request song song.
    const clientTime = isoTime(fields.client_time, 'client_time');
    const queuedAt = isoTime(fields.queued_at, 'queued_at');
    const syncedLate = !!(queuedAt && checkInAt.getTime() - new Date(queuedAt).getTime() > SYNC_LATE_MS);

    const saved = await one(
      `insert into timesheets
         (schedule_id, user_id, role, check_in_at, check_in_lat, check_in_lng, check_in_accuracy,
          check_in_distance_m, check_in_photo_id, check_in_device_count, check_in_note,
          gps_flagged, late_minutes, label, approval_status, client_time, queued_at, synced_late,
          linked_from)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       on conflict (schedule_id, user_id) do update set
         role                  = excluded.role,
         check_in_at           = excluded.check_in_at,
         check_in_lat          = excluded.check_in_lat,
         check_in_lng          = excluded.check_in_lng,
         check_in_accuracy     = excluded.check_in_accuracy,
         check_in_distance_m   = excluded.check_in_distance_m,
         check_in_photo_id     = excluded.check_in_photo_id,
         check_in_device_count = excluded.check_in_device_count,
         check_in_note         = excluded.check_in_note,
         gps_flagged           = excluded.gps_flagged,
         late_minutes          = excluded.late_minutes,
         label                 = excluded.label,
         approval_status       = excluded.approval_status,
         client_time           = excluded.client_time,
         queued_at             = excluded.queued_at,
         synced_late           = excluded.synced_late,
         linked_from           = excluded.linked_from
       where timesheets.check_in_at is null
       returning *`,
      [sch.id, user.id, role, checkInAt,
       hasCoord ? lat : null, hasCoord ? lng : null, hasCoord ? accuracy : null,
       distance, photo?.id ?? null, deviceCount, checkInNote,
       gpsFlagged, lateMinutes, label, approvalStatus, clientTime, queuedAt, syncedLate,
       linkedFirst?.id ?? null]
    );
    if (!saved) throw conflict('Bạn đã check-in buổi này rồi.');

    // Dữ liệu lương ⇒ luôn có vết nhật ký.
    audit(req, {
      action: 'create',
      entity: 'timesheets',
      entityId: saved.id,
      summary: `Check-in ${label === 'late' ? `trễ ${lateMinutes} phút` : 'đúng giờ'} — lớp ${sch.class_name}, ` +
               `${sch.school_name} ngày ${vnDate(sch.session_date)}${gpsFlagged ? ' (ngoài bán kính GPS)' : ''}.`,
      after: saved,
    });

    // Ngoài bán kính ⇒ báo Phòng chuyên môn phụ trách trường vào duyệt.
    if (gpsFlagged) {
      notifySchoolManagers(sch.school_id, {
        kind: 'timesheet_flagged',
        title: 'Chấm công ngoài bán kính GPS',
        body: `${user.full_name} check-in cách trường ${sch.school_name} ${distance}m ` +
              `(cho phép ${sch.gps_radius_m}m) — lớp ${sch.class_name} ngày ${vnDate(sch.session_date)}.`,
        link: '/cham-cong?duyet=1',
        refId: saved.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo timesheet_flagged'));
    }

    reply.code(201);
    return { ...saved, distance_m: saved.check_in_distance_m, linked: !!linkedFirst };
  });

  /* =========================================================================
   * POST /api/timesheets/check-out — multipart
   * ======================================================================= */
  app.post('/api/timesheets/check-out', { preHandler: requirePerm('timesheet.self') }, async (req) => {
    const user = req.user;
    const { fields, files } = await consumeMultipart(req, { userId: user.id });

    const scheduleId = uuid(fields.schedule_id, 'schedule_id', { required: true });
    const sch = await assertScheduleAccess(user, scheduleId);
    const role = roleInSchedule(user, sch);
    if (!role) throw forbidden('Bạn không được phân công buổi này.');
    await tagFilesSchool(files, sch.school_id);

    // 1. Phải ĐÃ check-in và CHƯA check-out.
    const ts = await one(
      'select * from timesheets where schedule_id = $1 and user_id = $2',
      [sch.id, user.id]
    );
    if (!ts || !ts.check_in_at) throw unprocessable('Bạn chưa check-in buổi này.');
    if (ts.check_out_at) throw conflict('Bạn đã check-out buổi này rồi.');

    // 2. Ép kiểu dữ liệu gửi lên.
    const deviceOk = bool(fields.device_ok, 'device_ok', { required: true });
    const damageNote = str(fields.damage_note, 'damage_note', { max: 2000 });
    const note = str(fields.note, 'note', { max: 2000 });
    const lat = num(fields.lat, 'lat', { min: -90, max: 90 });
    const lng = num(fields.lng, 'lng', { min: -180, max: 180 });
    const hasCoord = isValidCoord(lat, lng);
    const distance = hasCoord && isValidCoord(sch.school_lat, sch.school_lng)
      ? distanceMeters(lat, lng, sch.school_lat, sch.school_lng)
      : null;

    // 3. Thiết bị hỏng ⇒ bắt buộc mô tả + ảnh minh chứng.
    const damagePhotos = files.damage_photo || [];
    if (deviceOk === false && (!damageNote || !damagePhotos.length)) {
      throw unprocessable('Có thiết bị hỏng: bắt buộc mô tả và chụp ảnh minh chứng.');
    }

    // 4. Số phút làm việc thực tế theo giờ server.
    const checkOutAt = new Date();
    const minutes = workMinutes(ts.check_in_at, checkOutAt);
    const clientTime = isoTime(fields.client_time, 'client_time');
    const queuedAt = isoTime(fields.queued_at, 'queued_at');
    const syncedLate = !!(queuedAt && checkOutAt.getTime() - new Date(queuedAt).getTime() > SYNC_LATE_MS);
    const photoId = files.photo?.[0]?.id || null;

    // Cập nhật chấm công + tạo sự cố thiết bị + đóng buổi — trọn gói một giao dịch.
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
      if (!savedRow) throw conflict('Bạn đã check-out buổi này rồi.'); // race hai request song song

      let issueRow = null;
      if (deviceOk === false) {
        const ir = await c.query(
          `insert into device_issues
             (school_id, room_id, device_name, description, priority, status, source, source_id, reported_by)
           values ($1, $2, $3, $4, 'high', 'new', 'checkout', $5, $6)
           returning *`,
          [sch.school_id, sch.room_id, `Thiết bị phòng ${sch.room_name || sch.class_name}`,
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

      // Buổi đã dạy xong (không đụng tới buổi đã huỷ).
      await c.query(`update schedules set status = 'done' where id = $1 and status = 'scheduled'`, [sch.id]);
      return { saved: savedRow, issue: issueRow };
    });

    audit(req, {
      action: 'update',
      entity: 'timesheets',
      entityId: saved.id,
      summary: `Check-out lớp ${sch.class_name} — ${sch.school_name} ngày ${vnDate(sch.session_date)} ` +
               `(${minutes} phút làm việc)${deviceOk === false ? ', có thiết bị hỏng' : ''}.`,
      before: ts,
      after: saved,
    });

    if (issue) {
      notifySchoolManagers(sch.school_id, {
        kind: 'device_issue',
        title: 'Thiết bị hỏng sau buổi dạy',
        body: `${user.full_name} báo hỏng thiết bị tại ${sch.school_name} — lớp ${sch.class_name}: ${damageNote}`,
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
      `select t.*, s.school_id, s.session_date, sc.name as school_name,
              c.name as class_name, u.full_name as user_name
         from timesheets t
         join schedules s on s.id = t.schedule_id
         join schools sc on sc.id = s.school_id
         join classes c on c.id = s.class_id
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
               `lớp ${before.class_name}, ${before.school_name} ngày ${vnDate(before.session_date)}.`,
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
        ? `Chấm công buổi ${before.class_name} ngày ${vnDate(before.session_date)} đã được xác nhận.`
        : `Chấm công buổi ${before.class_name} ngày ${vnDate(before.session_date)} bị từ chối — lý do: ${reason}`,
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
      `select t.*, u.full_name as user_name, s.session_date,
              c.name as class_name, sc.name as school_name
         from timesheets t
         join users u on u.id = t.user_id
         join schedules s on s.id = t.schedule_id
         join classes c on c.id = s.class_id
         join schools sc on sc.id = s.school_id
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
      summary: `Sửa tay chấm công của ${before.user_name} — lớp ${before.class_name}, ` +
               `${before.school_name} ngày ${vnDate(before.session_date)}.`,
      before,
      after: saved,
    });

    return saved;
  });
}
