/**
 * jobs.js — Công việc nền chạy theo lịch (dùng setInterval, không cần cron ngoài).
 *
 *  1. markAbsences      — cuối ngày, gắn nhãn "Vắng" cho buổi đã qua mà không ai check-in.
 *  2. remindAttendance  — nhắc giáo viên buổi đã kết thúc mà chưa điểm danh.
 *  3. remindCheckout    — nhắc người đã check-in nhưng quên check-out.
 *  4. purgeNotifications— dọn thông báo cũ hơn 90 ngày.
 *
 * Toàn bộ mốc thời gian tính theo giờ Việt Nam (container đặt TZ=Asia/Ho_Chi_Minh).
 */
import { rows, query } from './db.js';
import { notify, purgeOld } from './lib/notify.js';
import { syncPendingFiles, driveEnabled } from './lib/drive.js';
import env from './env.js';

let timers = [];
let log = console;

const MINUTE = 60_000;

/** Giờ:phút hiện tại theo giờ VN. */
function nowVN() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
  return new Date(s);
}

/* ---------------------------------------------------------------------------
 * 1. Gắn nhãn Vắng cho buổi đã qua mà không có bản ghi chấm công.
 *    Tạo bản ghi timesheets với label='absent' để bảng lương không bị thiếu dòng.
 * ------------------------------------------------------------------------- */
export async function markAbsences() {
  const inserted = await rows(
    `insert into timesheets (schedule_id, user_id, role, label, approval_status)
     select s.id, p.user_id, p.role, 'absent'::attend_label, 'approved'::approval_status
       from schedules s
       cross join lateral (values
         (s.teacher_id, 'teacher'::class_role),
         (s.assistant_id, 'assistant'::class_role)
       ) as p (user_id, role)
      where p.user_id is not null
        and s.status = 'scheduled'
        -- buổi đã kết thúc quá 3 giờ
        and (s.session_date + s.end_time) < (now() at time zone 'Asia/Ho_Chi_Minh') - interval '3 hours'
        and s.session_date >= current_date - interval '7 days'
        and not exists (
          select 1 from timesheets t where t.schedule_id = s.id and t.user_id = p.user_id
        )
     returning id, user_id, schedule_id`
  );
  if (inserted.length) {
    log.info?.(`[jobs] Đã gắn nhãn Vắng cho ${inserted.length} lượt phân công.`);
  }
  return inserted.length;
}

/* ---------------------------------------------------------------------------
 * 2. Nhắc điểm danh: buổi kết thúc quá 30 phút mà chưa có bản ghi attendance.
 *    Chỉ nhắc mỗi buổi một lần (kiểm tra notifications theo ref_id).
 * ------------------------------------------------------------------------- */
export async function remindAttendance() {
  const pending = await rows(
    `select s.id, s.teacher_id, s.assistant_id, c.name as class_name, sc.name as school_name,
            s.session_date
       from schedules s
       join classes c on c.id = s.class_id
       join schools sc on sc.id = s.school_id
       left join attendance a on a.schedule_id = s.id
      where a.id is null
        and s.status = 'scheduled'
        and (s.session_date + s.end_time) < (now() at time zone 'Asia/Ho_Chi_Minh') - interval '30 minutes'
        and s.session_date >= current_date - interval '3 days'
        and not exists (
          select 1 from notifications n
           where n.ref_id = s.id and n.kind = 'attendance_missing'
        )
      limit 200`
  );

  for (const s of pending) {
    const targets = [s.teacher_id, s.assistant_id].filter(Boolean);
    if (!targets.length) continue;
    await notify(targets, {
      kind: 'attendance_missing',
      title: 'Chưa điểm danh lớp',
      body: `Buổi ${s.class_name} — ${s.school_name} ngày ${vnDate(s.session_date)} chưa được điểm danh.`,
      link: `/diem-danh/${s.id}`,
      refId: s.id,
    });
  }
  if (pending.length) log.info?.(`[jobs] Đã nhắc điểm danh ${pending.length} buổi.`);
  return pending.length;
}

/* ---------------------------------------------------------------------------
 * 3. Nhắc check-out: đã check-in nhưng quá giờ kết thúc + khung cho phép
 *    (checkout_grace_minutes cấu hình THEO TỪNG TRƯỜNG, chỉ Admin chỉnh).
 * ------------------------------------------------------------------------- */
export async function remindCheckout() {
  const pending = await rows(
    `select t.id, t.user_id, s.id as schedule_id, c.name as class_name, sc.name as school_name
       from timesheets t
       join schedules s on s.id = t.schedule_id
       join classes c on c.id = s.class_id
       join schools sc on sc.id = s.school_id
      where t.check_in_at is not null
        and t.check_out_at is null
        and (s.session_date + s.end_time)
            < (now() at time zone 'Asia/Ho_Chi_Minh')
              - make_interval(mins => coalesce(sc.checkout_grace_minutes, 45))
        and s.session_date >= current_date - interval '2 days'
        and not exists (
          select 1 from notifications n where n.ref_id = t.id and n.kind = 'checkout_missing'
        )
      limit 200`
  );

  for (const t of pending) {
    await notify(t.user_id, {
      kind: 'checkout_missing',
      title: 'Chưa check-out cuối buổi',
      body: `Bạn chưa check-out buổi ${t.class_name} — ${t.school_name}. Vui lòng hoàn tất để tính công đúng.`,
      link: `/cham-cong/${t.schedule_id}`,
      refId: t.id,
    });
  }
  if (pending.length) log.info?.(`[jobs] Đã nhắc check-out ${pending.length} lượt.`);
  return pending.length;
}

/* ---------------------------------------------------------------------------
 * 3b. Nhắc buổi dạy KẾ TIẾP: 60 phút trước giờ vào lớp, báo GV + TG một lần.
 * ------------------------------------------------------------------------- */
export async function remindUpcoming() {
  const upcoming = await rows(
    `select s.id, s.teacher_id, s.assistant_id, s.start_time,
            c.name as class_name, sc.name as school_name, r.name as room_name
       from schedules s
       join classes c on c.id = s.class_id
       join schools sc on sc.id = s.school_id
       left join stem_rooms r on r.id = s.room_id
      where s.status = 'scheduled'
        and s.session_date = ((now() at time zone 'Asia/Ho_Chi_Minh'))::date
        and (s.session_date + s.start_time)
            between (now() at time zone 'Asia/Ho_Chi_Minh')
                and (now() at time zone 'Asia/Ho_Chi_Minh') + interval '60 minutes'
        and not exists (
          select 1 from notifications n
           where n.ref_id = s.id and n.kind = 'schedule_reminder'
        )
      limit 200`
  );

  for (const s of upcoming) {
    const targets = [s.teacher_id, s.assistant_id].filter(Boolean);
    if (!targets.length) continue;
    await notify(targets, {
      kind: 'schedule_reminder',
      title: 'Sắp tới giờ dạy',
      body: `${String(s.start_time).slice(0, 5)} hôm nay — lớp ${s.class_name}, ${s.school_name}` +
            `${s.room_name ? ` (${s.room_name})` : ''}. Nhớ check-in đầu buổi nhé!`,
      link: `/cham-cong/${s.id}`,
      refId: s.id,
    });
  }
  if (upcoming.length) log.info?.(`[jobs] Đã nhắc ${upcoming.length} buổi sắp bắt đầu.`);
  return upcoming.length;
}

/* ---------------------------------------------------------------------------
 * 3c. Sao lưu ảnh/tài liệu lên Google Drive (nếu đã cấu hình).
 * ------------------------------------------------------------------------- */
export async function syncDrive() {
  if (!driveEnabled()) return 0;
  const r = await syncPendingFiles({ limit: 25 });
  if (r.sent || r.failed) {
    log.info?.(`[jobs] Drive: đã đẩy ${r.sent} tệp${r.failed ? `, lỗi ${r.failed}` : ''}.`);
  }
  return r.sent;
}

/* ---------------------------------------------------------------------------
 * 4. Dọn dữ liệu tạm.
 * ------------------------------------------------------------------------- */
export async function cleanup() {
  const n = await purgeOld(90);
  // Refresh token hết hạn quá 30 ngày thì xoá hẳn.
  const r = await query(
    `delete from refresh_tokens where expires_at < now() - interval '30 days'`
  );
  // Yêu cầu đặt lại mật khẩu đã dùng/hết hạn quá 7 ngày.
  await query(`delete from password_resets where created_at < now() - interval '7 days'`);
  if (n || r.rowCount) log.info?.(`[jobs] Dọn ${n} thông báo, ${r.rowCount} refresh token cũ.`);
}

function vnDate(d) {
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}/${y}`;
}

/** Chạy an toàn: lỗi của một job không làm chết tiến trình. */
async function safe(name, fn) {
  try {
    await fn();
  } catch (e) {
    log.error?.(`[jobs] ${name} lỗi: ${e.message}`);
  }
}

export function startJobs(logger) {
  log = logger || console;

  // Mỗi 10 phút: nhắc buổi sắp dạy (60 phút trước giờ vào lớp).
  timers.push(setInterval(() => safe('remindUpcoming', remindUpcoming), 10 * MINUTE));

  // Mỗi 15 phút: nhắc điểm danh & check-out.
  timers.push(setInterval(() => {
    safe('remindAttendance', remindAttendance);
    safe('remindCheckout', remindCheckout);
  }, 15 * MINUTE));

  // Mỗi giờ: gắn nhãn vắng.
  timers.push(setInterval(() => safe('markAbsences', markAbsences), 60 * MINUTE));

  // Sao lưu Drive theo chu kỳ cấu hình (mặc định 5 phút).
  if (driveEnabled()) {
    const every = Math.max(1, env.drive.syncMinutes) * MINUTE;
    timers.push(setInterval(() => safe('syncDrive', syncDrive), every));
    timers.push(setTimeout(() => safe('syncDrive', syncDrive), 30_000));
  }

  // Mỗi 6 giờ: dọn dữ liệu.
  timers.push(setInterval(() => safe('cleanup', cleanup), 6 * 60 * MINUTE));

  // Chạy một lượt sau 60s để không làm chậm lúc khởi động.
  timers.push(setTimeout(() => {
    safe('markAbsences', markAbsences);
    safe('remindAttendance', remindAttendance);
  }, MINUTE));

  log.info?.('[jobs] Đã bật các công việc nền.');
  void nowVN;
}

export function stopJobs() {
  timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  timers = [];
}
