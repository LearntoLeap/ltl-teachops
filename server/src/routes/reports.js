/**
 * reports.js — Mục 12 docs/API.md: dashboard tổng hợp + xuất Excel (.xlsx).
 *
 * Quy tắc:
 *   - Mọi truy vấn danh sách đi qua lib/scope.js (schoolFilter / scheduleFilter).
 *   - "Hôm nay" tính theo giờ Việt Nam (UTC+7), cộng bù tường minh — không phụ
 *     thuộc múi giờ của máy chủ.
 *   - Mọi endpoint .xlsx ghi audit với action='export'.
 */
import { rows, one } from '../db.js';
import { requirePerm, requireRole, assertPerm, isFieldStaff } from '../lib/rbac.js';
import { schoolFilter, scheduleFilter } from '../lib/scope.js';
import { uuid, dateRange } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { sendXlsx, isPreview, LABELS, formatVN, formatVNDate, formatVNTime } from '../lib/xlsx.js';

/* ----------------------------- Tiện ích chung ------------------------------ */

/** Ngày hôm nay theo giờ Việt Nam, dạng 'YYYY-MM-DD'. */
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Giờ VN hiện tại trong SQL (timestamp không múi giờ — so được với date + time). */
const VN_NOW = `(now() at time zone 'Asia/Ho_Chi_Minh')`;

/** 'HH:MM:SS' → 'HH:MM'. */
const hhmm = (t) => String(t || '').slice(0, 5);

const YES = 'Có';
const DASH = '—';

/** Vai trò trong buổi (class_role) — LABELS của xlsx.js không có map này. */

/**
 * Mệnh đề phạm vi trường + lọc school_id client gửi (nếu có).
 * `next` là số thứ tự tham số kế tiếp của truy vấn đang ghép.
 */
async function schoolScope(user, col, next, schoolId) {
  const f = await schoolFilter(user, col, next);
  let sql = f.sql;
  const params = [...f.params];
  next = f.next;
  if (schoolId) {
    sql += ` and ${col} = $${next}`;
    params.push(schoolId);
    next += 1;
  }
  return { sql, params, next };
}

/* ------------------- Cột & dòng dùng chung cho chấm công ------------------- */

const SESSION_VN = { morning: 'Sáng', afternoon: 'Chiều' };

/**
 * Bảng chấm công — MỘT DÒNG MỖI BUỔI (sáng/chiều) của mỗi người, không phải mỗi
 * tiết. Giáo viên đến trường chấm công vào, ra về chấm công ra; kiểm thiết bị
 * đầu và cuối buổi nằm luôn ở đây.
 */
const TIMESHEET_COLUMNS = [
  { header: 'Ngày', key: 'date', width: 12, align: 'center' },
  { header: 'Buổi', key: 'session', width: 8, align: 'center' },
  { header: 'Trường', key: 'school', width: 26 },
  { header: 'Họ tên', key: 'name', width: 24 },
  { header: 'Giờ phải có mặt', key: 'planned', width: 13, align: 'center' },
  { header: 'Chấm công vào', key: 'check_in', width: 12, align: 'center' },
  { header: 'Chấm công ra', key: 'check_out', width: 12, align: 'center' },
  { header: 'Nhãn', key: 'label', width: 10, align: 'center' },
  { header: 'Phút trễ', key: 'late', width: 9, align: 'right' },
  { header: 'Phút làm việc', key: 'work', width: 12, align: 'right' },
  { header: 'Tiết theo lịch', key: 'periods', width: 11, align: 'right' },
  { header: 'Thiết bị đầu buổi', key: 'dev_in', width: 12, align: 'right' },
  { header: 'Thiết bị cuối buổi', key: 'dev_out', width: 13, align: 'center' },
  { header: 'GPS lệch', key: 'gps', width: 9, align: 'center' },
  { header: 'Duyệt', key: 'approval', width: 11, align: 'center' },
];

function timesheetRow(v) {
  return {
    date: formatVNDate(v.work_date),
    session: SESSION_VN[v.work_session] || '',
    school: v.school_name,
    name: v.full_name,
    planned: v.planned_start_time ? hhmm(v.planned_start_time) : DASH,
    check_in: formatVNTime(v.check_in_at),
    check_out: formatVNTime(v.check_out_at),
    label: LABELS.label[v.label] || '',
    late: v.late_minutes ?? 0,
    work: v.work_minutes ?? 0,
    periods: v.planned_periods ?? 0,
    dev_in: v.check_in_device_count ?? DASH,
    dev_out: v.device_ok === null || v.device_ok === undefined
      ? DASH : (v.device_ok ? 'Nguyên vẹn' : 'Có hỏng'),
    gps: v.gps_flagged ? YES : DASH,
    approval: LABELS.approval[v.approval_status] || DASH,
  };
}

/** Chấm công theo buổi — dùng cho timesheets.xlsx và sheet "Chi tiết" của payroll.xlsx. */
async function fetchTimesheetDetail(user, { from, to, schoolId, userId }) {
  const where = ['v.work_date between $1 and $2'];
  const params = [from, to];
  let next = 3;

  const sf = await schoolFilter(user, 'v.school_id', next);
  where.push(sf.sql);
  params.push(...sf.params);
  next = sf.next;

  if (schoolId) { where.push(`v.school_id = $${next}`); params.push(schoolId); next += 1; }
  if (userId)   { where.push(`v.user_id = $${next}`);   params.push(userId);   next += 1; }

  return rows(
    `select v.* from v_work_shifts v
      where ${where.join(' and ')}
      order by v.work_date, v.work_session, v.school_name, v.full_name`,
    params
  );
}

/* --------------------------------- Routes ---------------------------------- */

export default async function routes(app) {
  /* ======================================================================== *
   * GET /api/reports/admin-overview — CHỈ admin: sức khoẻ toàn hệ thống.
   * Trả: quy mô tổ chức, nhân sự theo vai trò, hàng đợi cần xử lý,
   * nhật ký & tài khoản mới nhất — dữ liệu cho dashboard Quản trị viên.
   * ======================================================================== */
  app.get('/api/reports/admin-overview', { preHandler: requireRole('admin') }, async () => {
    const today = vnToday();

    const [org, staff, flagged, issueCounts, fbNew, matPending, recentAudit, todaySchedule, recentUsers] =
      await Promise.all([
        one(
          `select
             (select count(*)::int from schools where is_active) as schools,
             (select count(*)::int from classes where is_active) as classes,
             (select count(*)::int from stem_rooms where is_active) as rooms,
             (select count(*)::int from schedules
               where status <> 'cancelled'
                 and session_date between date_trunc('week', $1::date)::date
                 and (date_trunc('week', $1::date) + interval '6 days')::date) as week_sessions,
             (select count(*)::int from schedules
               where status <> 'cancelled' and session_date = $1::date) as today_sessions`,
          [today]
        ),
        rows(`select role, count(*)::int as cnt from users where is_active group by role`),
        one(`select count(*)::int as cnt from timesheets where approval_status = 'pending'`),
        rows(`select status, count(*)::int as cnt from device_issues
               where status <> 'resolved' group by status`),
        one(`select count(*)::int as cnt from feedback where status = 'new'`),
        one(`select count(*)::int as cnt from materials
              where approval_status = 'pending' and area = 'teacher' and not is_archived`),
        rows(
          `select a.id, a.action, a.entity, a.summary, a.created_at,
                  coalesce(u.full_name, a.actor_email) as actor_name
             from audit_log a
             left join users u on u.id = a.actor_id
            order by a.created_at desc
            limit 6`
        ),
        // Lịch dạy HÔM NAY toàn hệ thống — hiện ngay trên trang chủ Quản trị
        rows(
          `select s.id, s.start_time, s.end_time, s.subject,
                  c.name as class_name, sc.name as school_name, r.name as room_name,
                  coalesce(t.full_name, s.teacher_manual_name)   as teacher_name,
                  coalesce(a.full_name, s.assistant_manual_name) as assistant_name,
                  (ts.id is not null) as has_timesheet,
                  (att.id is not null) as has_attendance
             from schedules s
             join classes c on c.id = s.class_id
             join schools sc on sc.id = s.school_id
             left join stem_rooms r on r.id = s.room_id
             left join users t on t.id = s.teacher_id
             left join users a on a.id = s.assistant_id
             left join lateral (
               select id from timesheets where schedule_id = s.id limit 1
             ) ts on true
             left join attendance att on att.schedule_id = s.id
            where s.session_date = $1::date and s.status <> 'cancelled'
            order by s.start_time, sc.name
            limit 30`,
          [today]
        ),
        rows(
          `select id, full_name, role, created_at, last_login_at
             from users where is_active
            order by created_at desc
            limit 5`
        ),
      ]);

    const staffByRole = { admin: 0, manager: 0, teacher: 0, assistant: 0 };
    for (const r of staff) staffByRole[r.role] = r.cnt;
    const openIssues = { new: 0, in_progress: 0 };
    for (const r of issueCounts) openIssues[r.status] = r.cnt;

    return {
      org: {
        schools: org?.schools ?? 0,
        classes: org?.classes ?? 0,
        rooms: org?.rooms ?? 0,
        week_sessions: org?.week_sessions ?? 0,
        today_sessions: org?.today_sessions ?? 0,
      },
      staff: staffByRole,
      queues: {
        flagged_timesheets: flagged?.cnt ?? 0,
        open_issues: openIssues,
        feedback_new: fbNew?.cnt ?? 0,
        materials_pending: matPending?.cnt ?? 0,
      },
      recent_audit: recentAudit,
      today_schedule: todaySchedule,
      recent_users: recentUsers,
    };
  });

  /* ======================================================================== *
   * GET /api/reports/dashboard — admin, manager (report.view)
   * ======================================================================== */
  app.get('/api/reports/dashboard', { preHandler: requirePerm('report.view') }, async (req) => {
    const schoolId = uuid(req.query.school_id, 'school_id');
    const today = vnToday();

    // Mỗi truy vấn tự đánh số tham số riêng nên gọi schoolScope riêng cho từng cái.
    const [s1, s2, s3, s4, s5, s6, s7] = await Promise.all([
      schoolScope(req.user, 's.school_id', 2, schoolId), // buổi hôm nay + điểm danh
      schoolScope(req.user, 'v.school_id', 2, schoolId), // chấm công hôm nay
      schoolScope(req.user, 'd.school_id', 1, schoolId), // sự cố thiết bị đang mở
      schoolScope(req.user, 'f.school_id', 1, schoolId), // góp ý mới
      schoolScope(req.user, 's.school_id', 1, schoolId), // chấm công chờ duyệt
      schoolScope(req.user, 'd.school_id', 1, schoolId), // 5 sự cố mới nhất
      schoolScope(req.user, 'p.school_id', 1, schoolId), // 5 buổi chưa điểm danh
    ]);

    const [sess, people, issueCounts, fbNew, flagged, recentIssues, pendingAttendance] =
      await Promise.all([
        // Số buổi hôm nay + điểm danh xong / còn thiếu (chỉ tính buổi đã tới giờ vào lớp)
        one(
          `select count(*)::int as sessions,
                  count(att.id)::int as attendance_done,
                  count(*) filter (where att.id is null
                                     and (s.session_date + s.start_time) <= ${VN_NOW})::int
                    as attendance_pending
             from schedules s
             left join attendance att on att.schedule_id = s.id
            where s.session_date = $1 and s.status <> 'cancelled' and ${s1.sql}`,
          [today, ...s1.params]
        ),
        // Chấm công hôm nay theo người (vắng chỉ tính buổi đã kết thúc)
        one(
          `select count(*) filter (where v.check_in_at is not null)::int as checked_in,
                  count(*) filter (where v.label = 'ontime')::int as ontime,
                  count(*) filter (where v.label = 'late')::int as late,
                  count(*) filter (where v.check_in_at is null)::int as absent
             from v_work_shifts v
            where v.work_date = $1 and ${s2.sql}`,
          [today, ...s2.params]
        ),
        // Sự cố thiết bị chưa khắc phục, đếm theo trạng thái
        rows(
          `select d.status, count(*)::int as cnt
             from device_issues d
            where d.status <> 'resolved' and ${s3.sql}
            group by d.status`,
          s3.params
        ),
        // Góp ý mới
        one(
          `select count(*)::int as cnt from feedback f
            where f.status = 'new' and ${s4.sql}`,
          s4.params
        ),
        // Chấm công GPS lệch đang chờ duyệt
        one(
          `select count(*)::int as cnt
             from timesheets t join schedules s on s.id = t.schedule_id
            where t.approval_status = 'pending' and ${s5.sql}`,
          s5.params
        ),
        // 5 sự cố thiết bị mới nhất
        rows(
          `select d.id, d.device_name, d.quantity, d.description, d.priority, d.status,
                  d.created_at, sc.name as school_name, r.name as room_name,
                  u.full_name as reported_by_name
             from device_issues d
             join schools sc on sc.id = d.school_id
             left join stem_rooms r on r.id = d.room_id
             left join users u on u.id = d.reported_by
            where ${s6.sql}
            order by d.created_at desc
            limit 5`,
          s6.params
        ),
        // 5 buổi gần nhất chưa điểm danh (kèm tên trường/lớp/người phụ trách)
        rows(
          `select p.schedule_id, p.session_date, p.start_time,
                  sc.name as school_name, c.name as class_name,
                  coalesce(t.full_name, p.teacher_manual_name)   as teacher_name,
                  coalesce(a.full_name, p.assistant_manual_name) as assistant_name
             from v_attendance_pending p
             join schools sc on sc.id = p.school_id
             join classes c on c.id = p.class_id
             left join users t on t.id = p.teacher_id
             left join users a on a.id = p.assistant_id
            where ${s7.sql}
            order by p.session_date desc, p.start_time desc
            limit 5`,
          s7.params
        ),
      ]);

    const openIssues = { new: 0, in_progress: 0 };
    for (const r of issueCounts) openIssues[r.status] = r.cnt;

    return {
      today: {
        sessions: sess?.sessions ?? 0,
        checked_in: people?.checked_in ?? 0,
        ontime: people?.ontime ?? 0,
        late: people?.late ?? 0,
        absent: people?.absent ?? 0,
        attendance_done: sess?.attendance_done ?? 0,
        attendance_pending: sess?.attendance_pending ?? 0,
      },
      open_issues: openIssues,
      feedback_new: fbNew?.cnt ?? 0,
      flagged_timesheets: flagged?.cnt ?? 0,
      recent_issues: recentIssues,
      pending_attendance: pendingAttendance,
    };
  });

  /* ======================================================================== *
   * GET /api/reports/my-dashboard — mọi vai trò (dashboard cá nhân)
   * ======================================================================== */
  app.get('/api/reports/my-dashboard', async (req) => {
    const me = req.user.id;
    const today = vnToday();

    const [todaySessions, notCheckedOut, attendanceMissing, myMonth, unread] = await Promise.all([
      // Buổi hôm nay của tôi + trạng thái check-in/out + đã điểm danh chưa
      rows(
        `select s.id, s.session_date, s.start_time, s.end_time, s.subject, s.status,
                sc.name as school_name, c.name as class_name, r.name as room_name,
                case when s.teacher_id = $1 then 'teacher' else 'assistant' end as my_role,
                t.check_in_at, t.check_out_at, t.label, t.late_minutes,
                t.gps_flagged, t.approval_status,
                (att.id is not null) as attendance_done
           from schedules s
           join schools sc on sc.id = s.school_id
           join classes c on c.id = s.class_id
           left join stem_rooms r on r.id = s.room_id
           left join timesheets t on t.schedule_id = s.id and t.user_id = $1
           left join attendance att on att.schedule_id = s.id
          where s.session_date = $2 and s.status <> 'cancelled'
            and (s.teacher_id = $1 or s.assistant_id = $1)
          order by s.start_time`,
        [me, today]
      ),
      // Đã check-in nhưng quên check-out
      one(
        `select count(*)::int as cnt from timesheets t
          where t.user_id = $1 and t.check_in_at is not null and t.check_out_at is null`,
        [me]
      ),
      // Buổi 3 ngày gần đây (kể cả hôm nay) đã tới giờ mà tôi chưa điểm danh
      one(
        `select count(*)::int as cnt
           from schedules s
           left join attendance att on att.schedule_id = s.id
          where (s.teacher_id = $1 or s.assistant_id = $1)
            and s.status = 'scheduled'
            and s.session_date between ($2::date - 2) and $2::date
            and (s.session_date + s.start_time) <= ${VN_NOW}
            and att.id is null`,
        [me, today]
      ),
      // Tổng hợp tháng hiện tại của tôi (vắng chỉ tính buổi đã kết thúc)
      one(
        `select count(*)::int as sessions,
                count(*) filter (where v.label = 'ontime')::int as ontime,
                count(*) filter (where v.label = 'late')::int as late,
                count(*) filter (where v.check_in_at is null)::int as absent,
                coalesce(sum(v.work_minutes), 0)::int as work_minutes
           from v_work_shifts v
          where v.user_id = $1
            and v.work_date >= date_trunc('month', $2::date)::date
            and v.work_date <= (date_trunc('month', $2::date) + interval '1 month - 1 day')::date`,
        [me, today]
      ),
      one(
        `select count(*)::int as cnt from notifications where user_id = $1 and read_at is null`,
        [me]
      ),
    ]);

    return {
      today_sessions: todaySessions,
      pending_tasks: {
        not_checked_out: notCheckedOut?.cnt ?? 0,
        attendance_missing: attendanceMissing?.cnt ?? 0,
      },
      my_month: {
        sessions: myMonth?.sessions ?? 0,
        ontime: myMonth?.ontime ?? 0,
        late: myMonth?.late ?? 0,
        absent: myMonth?.absent ?? 0,
        work_minutes: myMonth?.work_minutes ?? 0,
      },
      unread_notifications: unread?.cnt ?? 0,
    };
  });

  /* ======================================================================== *
   * GET /api/reports/timesheets.xlsx — bảng chấm công
   *   teacher/assistant: ép user_id = chính mình (export.self)
   *   admin/manager: toàn phạm vi hoặc người khác (export.scope)
   * ======================================================================== */
  app.get('/api/reports/timesheets.xlsx', async (req, reply) => {
    assertPerm(req.user, 'export.self');   // mọi vai trò đều có — giữ hợp đồng tường minh

    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    let userId = uuid(req.query.user_id, 'user_id');

    if (isFieldStaff(req.user)) {
      userId = req.user.id;                 // GV/TG chỉ xuất được dữ liệu của chính mình
    } else if (userId !== req.user.id) {
      assertPerm(req.user, 'export.scope'); // xuất người khác / toàn phạm vi
    }

    const data = await fetchTimesheetDetail(req.user, { from, to, schoolId, userId });
    void classId;   // chấm công theo buổi không gắn với lớp

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất bảng chấm công ${formatVNDate(from)}–${formatVNDate(to)} (${data.length} dòng)`,
    });

    return sendXlsx(reply, {
      fileName: `bang-cham-cong-${from}-${to}`,
      title: 'BẢNG CHẤM CÔNG THEO BUỔI',
      subtitle: `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`,
      columns: TIMESHEET_COLUMNS,
      rows: data.map(timesheetRow),
    });
  });

  /* ======================================================================== *
   * GET /api/reports/payroll.xlsx — tổng hợp tính lương (export.scope)
   * ======================================================================== */
  app.get('/api/reports/payroll.xlsx', { preHandler: requirePerm('export.scope') }, async (req, reply) => {
    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');

    const where = ['v.work_date between $1 and $2'];
    const params = [from, to];
    let next = 3;
    const sf = await schoolFilter(req.user, 'v.school_id', next);
    where.push(sf.sql);
    params.push(...sf.params);
    next = sf.next;
    if (schoolId) { where.push(`v.school_id = $${next}`); params.push(schoolId); next += 1; }
    if (userId)   { where.push(`v.user_id = $${next}`);   params.push(userId);   next += 1; }
    void classId;   // lọc theo lớp không còn nghĩa với chấm công theo buổi

    const [summary, detail] = await Promise.all([
      rows(
        `select v.user_id, v.full_name, u.email, u.role as account_role,
                count(*)::int as total_shifts,
                count(*) filter (where v.check_in_at is not null)::int as worked,
                count(*) filter (where v.check_out_at is null and v.check_in_at is not null)::int as no_checkout,
                count(*) filter (where v.label = 'ontime')::int as ontime,
                count(*) filter (where v.label = 'late')::int as late,
                coalesce(sum(v.planned_periods), 0)::int as periods,
                coalesce(sum(v.late_minutes), 0)::int as late_minutes,
                coalesce(sum(v.work_minutes), 0)::int as work_minutes,
                count(*) filter (where v.gps_flagged and v.approval_status = 'pending')::int as gps_pending
           from v_work_shifts v
           join users u on u.id = v.user_id
          where ${where.join(' and ')}
          group by v.user_id, v.full_name, u.email, u.role
          order by v.full_name`,
        params
      ),
      fetchTimesheetDetail(req.user, { from, to, schoolId, userId }),
    ]);

    const subtitle = `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`;

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất bảng tổng hợp lương ${formatVNDate(from)}–${formatVNDate(to)} (${summary.length} người)`,
    });

    return sendXlsx(reply, {
      fileName: `tong-hop-luong-${from}-${to}`,
      sheets: [
        {
          name: 'Tổng hợp',
          title: 'BẢNG TỔNG HỢP CHẤM CÔNG TÍNH LƯƠNG',
          subtitle,
          columns: [
            { header: 'Họ tên', key: 'name', width: 24 },
            { header: 'Email', key: 'email', width: 26 },
            { header: 'Vai trò', key: 'role', width: 15, align: 'center' },
            { header: 'Số buổi công', key: 'shifts', width: 11, align: 'right' },
            { header: 'Buổi có chấm công vào', key: 'worked', width: 13, align: 'right' },
            { header: 'Thiếu chấm công ra', key: 'no_checkout', width: 12, align: 'right' },
            { header: 'Đúng giờ', key: 'ontime', width: 10, align: 'right' },
            { header: 'Trễ', key: 'late', width: 8, align: 'right' },
            { header: 'Tổng tiết theo lịch', key: 'periods', width: 12, align: 'right' },
            { header: 'Tổng phút trễ', key: 'late_minutes', width: 11, align: 'right' },
            { header: 'Tổng phút làm việc', key: 'work_minutes', width: 13, align: 'right' },
            { header: 'Buổi GPS lệch chờ duyệt', key: 'gps_pending', width: 13, align: 'right' },
          ],
          rows: summary.map((r) => ({
            name: r.full_name,
            email: r.email,
            role: LABELS.role[r.account_role] || r.account_role,
            shifts: r.total_shifts,
            worked: r.worked,
            no_checkout: r.no_checkout,
            ontime: r.ontime,
            late: r.late,
            periods: r.periods,
            late_minutes: r.late_minutes,
            work_minutes: r.work_minutes,
            gps_pending: r.gps_pending,
          })),
        },
        {
          name: 'Chi tiết',
          title: 'CHI TIẾT CHẤM CÔNG THEO BUỔI',
          subtitle,
          columns: TIMESHEET_COLUMNS,
          rows: detail.map(timesheetRow),
        },
      ],
    });
  });

  /* ======================================================================== *
   * GET /api/reports/class-sessions.xlsx — LỊCH DẠY & ĐIỂM DANH theo TIẾT
   * Khớp đúng những gì hiện trên màn Lịch dạy và màn Điểm danh.
   * ======================================================================== */
  app.get('/api/reports/class-sessions.xlsx', { preHandler: requirePerm('export.scope') }, async (req, reply) => {
    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');

    const where = ['v.session_date between $1 and $2'];
    const params = [from, to];
    let next = 3;
    const sf = await schoolFilter(req.user, 'v.school_id', next);
    where.push(sf.sql);
    params.push(...sf.params);
    next = sf.next;
    if (schoolId) { where.push(`v.school_id = $${next}`); params.push(schoolId); next += 1; }
    if (classId)  { where.push(`v.class_id = $${next}`);  params.push(classId);  next += 1; }
    if (userId)   { where.push(`v.user_id = $${next}`);   params.push(userId);   next += 1; }

    const data = await rows(
      `select v.* from v_class_sessions v
        where ${where.join(' and ')}
        order by v.session_date, v.school_name, v.start_time, v.class_name, v.full_name`,
      params
    );

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất lịch dạy & điểm danh ${formatVNDate(from)}–${formatVNDate(to)} (${data.length} dòng)`,
    });

    return sendXlsx(reply, {
      fileName: `lich-day-diem-danh-${from}-${to}`,
      title: 'LỊCH DẠY & ĐIỂM DANH THEO TIẾT',
      subtitle: `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`,
      columns: [
        { header: 'Ngày', key: 'date', width: 12, align: 'center' },
        { header: 'Tiết', key: 'period', width: 7, align: 'center' },
        { header: 'Giờ', key: 'time', width: 13, align: 'center' },
        { header: 'Trường', key: 'school', width: 24 },
        { header: 'Lớp', key: 'clazz', width: 9, align: 'center' },
        { header: 'Môn / chủ đề', key: 'subject', width: 22 },
        { header: 'Người phụ trách', key: 'name', width: 22 },
        { header: 'Vai trò', key: 'role', width: 11, align: 'center' },
        { header: 'Đã chấm công', key: 'shift', width: 12, align: 'center' },
        { header: 'Đã điểm danh', key: 'done', width: 11, align: 'center' },
        { header: 'Giờ check tại lớp', key: 'class_in', width: 13, align: 'center' },
        { header: 'Sĩ số', key: 'roster', width: 8, align: 'right' },
        { header: 'Có mặt', key: 'present', width: 8, align: 'right' },
        { header: 'Người điểm danh', key: 'marker', width: 20 },
        { header: 'GV tự thêm', key: 'self', width: 10, align: 'center' },
        { header: 'Người thêm', key: 'added_by', width: 20 },
        { header: 'Lý do thêm', key: 'reason', width: 34, wrap: true },
      ],
      rows: data.map((v) => ({
        date: formatVNDate(v.session_date),
        period: v.period ?? hhmm(v.start_time),
        time: `${hhmm(v.start_time)}–${hhmm(v.end_time)}`,
        school: v.school_name,
        clazz: v.class_name,
        subject: v.subject || DASH,
        name: v.full_name,
        role: LABELS.classRole?.[v.session_role] || (v.session_role === 'assistant' ? 'Trợ giảng' : 'Giáo viên'),
        shift: v.shift_check_in_at ? formatVNTime(v.shift_check_in_at) : 'Chưa',
        done: v.attendance_done ? 'Đã' : 'Chưa',
        class_in: formatVNTime(v.class_check_in_at),
        roster: v.roster_size ?? DASH,
        present: v.present_count ?? DASH,
        marker: v.marked_by_name || DASH,
        self: v.self_added ? YES : DASH,
        added_by: v.self_added ? (v.added_by_name || DASH) : DASH,
        reason: v.self_added ? (v.self_added_reason || DASH) : DASH,
      })),
    });
  });

  /* ======================================================================== *
   * GET /api/reports/attendance.xlsx — điểm danh học sinh (scope như danh sách)
   * ======================================================================== */
  app.get('/api/reports/attendance.xlsx', async (req, reply) => {
    assertPerm(req.user, 'export.self');

    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');

    const where = ['s.session_date between $1 and $2'];
    const params = [from, to];
    let next = 3;
    // scheduleFilter xử lý cả 4 vai trò: GV/TG chỉ thấy buổi của mình
    const sf = await scheduleFilter(req.user, 's', next);
    where.push(sf.sql);
    params.push(...sf.params);
    next = sf.next;
    if (schoolId) { where.push(`a.school_id = $${next}`); params.push(schoolId); next += 1; }
    if (classId)  { where.push(`a.class_id = $${next}`);  params.push(classId);  next += 1; }
    if (userId)   { where.push(`a.marked_by = $${next}`); params.push(userId);   next += 1; }

    const data = await rows(
      `select s.session_date, s.start_time, s.period, sc.name as school_name, c.name as class_name,
              u.full_name as marked_by_name, a.checked_in_at, a.gps_flagged,
              a.roster_size, a.present_count, a.note, a.synced_late
         from attendance a
         join schedules s on s.id = a.schedule_id
         join schools sc on sc.id = a.school_id
         join classes c on c.id = a.class_id
         join users u on u.id = a.marked_by
        where ${where.join(' and ')}
        order by s.session_date, sc.name, s.start_time`,
      params
    );

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất báo cáo điểm danh ${formatVNDate(from)}–${formatVNDate(to)} (${data.length} dòng)`,
    });

    return sendXlsx(reply, {
      fileName: `diem-danh-${from}-${to}`,
      title: 'BÁO CÁO ĐIỂM DANH HỌC SINH',
      subtitle: `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`,
      columns: [
        { header: 'Ngày', key: 'date', width: 12, align: 'center' },
        { header: 'Tiết', key: 'period', width: 7, align: 'center' },
        { header: 'Trường', key: 'school', width: 26 },
        { header: 'Lớp', key: 'clazz', width: 10, align: 'center' },
        { header: 'Người điểm danh', key: 'marker', width: 22 },
        { header: 'Giờ check tại lớp', key: 'class_in', width: 13, align: 'center' },
        { header: 'Sĩ số chuẩn', key: 'roster', width: 10, align: 'right' },
        { header: 'Có mặt', key: 'present', width: 9, align: 'right' },
        { header: 'Vắng', key: 'absent', width: 8, align: 'right' },
        { header: 'GPS lệch', key: 'gps', width: 9, align: 'center' },
        { header: 'Ghi chú', key: 'note', width: 30, wrap: true },
        { header: 'Đồng bộ trễ', key: 'late_sync', width: 10, align: 'center' },
      ],
      rows: data.map((a) => ({
        date: formatVNDate(a.session_date),
        period: a.period ?? hhmm(a.start_time),
        school: a.school_name,
        clazz: a.class_name,
        marker: a.marked_by_name,
        class_in: formatVNTime(a.checked_in_at),
        roster: a.roster_size,
        present: a.present_count,
        absent: Math.max(0, (a.roster_size ?? 0) - (a.present_count ?? 0)),
        gps: a.gps_flagged ? YES : DASH,
        note: a.note || '',
        late_sync: a.synced_late ? YES : DASH,
      })),
    });
  });

  /* ======================================================================== *
   * GET /api/reports/devices.xlsx — 2 sheet: Kiểm kê + Báo hỏng
   * ======================================================================== */
  app.get('/api/reports/devices.xlsx', async (req, reply) => {
    assertPerm(req.user, 'export.self');

    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const userId = uuid(req.query.user_id, 'user_id');
    uuid(req.query.class_id, 'class_id'); // chấp nhận tham số chung nhưng không áp cho thiết bị

    // Sheet 1 — kiểm kê thiết bị
    const w1 = ['dc.check_date between $1 and $2'];
    const p1 = [from, to];
    let n1 = 3;
    const sc1 = await schoolScope(req.user, 'dc.school_id', n1, schoolId);
    w1.push(sc1.sql);
    p1.push(...sc1.params);
    n1 = sc1.next;
    if (userId) { w1.push(`dc.user_id = $${n1}`); p1.push(userId); n1 += 1; }

    // Sheet 2 — báo hỏng (ngày báo tính theo giờ VN)
    const w2 = [`(di.created_at at time zone 'Asia/Ho_Chi_Minh')::date between $1 and $2`];
    const p2 = [from, to];
    let n2 = 3;
    const sc2 = await schoolScope(req.user, 'di.school_id', n2, schoolId);
    w2.push(sc2.sql);
    p2.push(...sc2.params);
    n2 = sc2.next;
    if (userId) { w2.push(`di.reported_by = $${n2}`); p2.push(userId); n2 += 1; }

    const [checks, issues] = await Promise.all([
      rows(
        `select dc.check_date, dc.slot, dc.note, dc.has_shortage,
                jsonb_array_length(dc.items)::int as item_count,
                sc.name as school_name, r.name as room_name, u.full_name as checker_name
           from device_checks dc
           join schools sc on sc.id = dc.school_id
           join stem_rooms r on r.id = dc.room_id
           join users u on u.id = dc.user_id
          where ${w1.join(' and ')}
          order by dc.check_date desc, sc.name, r.name, dc.slot`,
        p1
      ),
      rows(
        `select di.created_at, di.device_name, di.quantity, di.description,
                di.priority, di.status, di.resolved_at,
                sc.name as school_name, r.name as room_name,
                ru.full_name as reporter_name, au.full_name as assignee_name
           from device_issues di
           join schools sc on sc.id = di.school_id
           left join stem_rooms r on r.id = di.room_id
           left join users ru on ru.id = di.reported_by
           left join users au on au.id = di.assigned_to
          where ${w2.join(' and ')}
          order by di.created_at desc`,
        p2
      ),
    ]);

    const subtitle = `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`;

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary:
        `Xuất báo cáo thiết bị ${formatVNDate(from)}–${formatVNDate(to)} ` +
        `(${checks.length} lượt kiểm kê, ${issues.length} báo hỏng)`,
    });

    return sendXlsx(reply, {
      fileName: `bao-cao-thiet-bi-${from}-${to}`,
      sheets: [
        {
          name: 'Kiểm kê',
          title: 'KIỂM KÊ THIẾT BỊ PHÒNG STEM',
          subtitle,
          columns: [
            { header: 'Ngày', key: 'date', width: 12, align: 'center' },
            { header: 'Trường', key: 'school', width: 26 },
            { header: 'Phòng', key: 'room', width: 16 },
            { header: 'Mốc', key: 'slot', width: 14, align: 'center' },
            { header: 'Người kiểm', key: 'checker', width: 22 },
            { header: 'Số mục', key: 'items', width: 8, align: 'right' },
            { header: 'Lệch', key: 'shortage', width: 8, align: 'center' },
            { header: 'Ghi chú', key: 'note', width: 30, wrap: true },
          ],
          rows: checks.map((c) => ({
            date: formatVNDate(c.check_date),
            school: c.school_name,
            room: c.room_name,
            slot: LABELS.slot[c.slot] || c.slot,
            checker: c.checker_name,
            items: c.item_count ?? 0,
            shortage: c.has_shortage ? YES : DASH,
            note: c.note || '',
          })),
        },
        {
          name: 'Báo hỏng',
          title: 'DANH SÁCH BÁO HỎNG THIẾT BỊ',
          subtitle,
          columns: [
            { header: 'Ngày báo', key: 'date', width: 14, align: 'center' },
            { header: 'Trường', key: 'school', width: 26 },
            { header: 'Phòng', key: 'room', width: 16 },
            { header: 'Thiết bị', key: 'device', width: 20 },
            { header: 'SL', key: 'qty', width: 6, align: 'right' },
            { header: 'Mô tả', key: 'desc', width: 32, wrap: true },
            { header: 'Ưu tiên', key: 'priority', width: 10, align: 'center' },
            { header: 'Trạng thái', key: 'status', width: 11, align: 'center' },
            { header: 'Người báo', key: 'reporter', width: 20 },
            { header: 'Người xử lý', key: 'assignee', width: 20 },
            { header: 'Ngày xong', key: 'done', width: 14, align: 'center' },
          ],
          rows: issues.map((i) => ({
            date: formatVN(i.created_at),
            school: i.school_name,
            room: i.room_name || '',
            device: i.device_name,
            qty: i.quantity,
            desc: i.description,
            priority: LABELS.priority[i.priority] || i.priority,
            status: LABELS.issue[i.status] || i.status,
            reporter: i.reporter_name || '',
            assignee: i.assignee_name || '',
            done: formatVN(i.resolved_at),
          })),
        },
      ],
    });
  });

  /* ======================================================================== *
   * GET /api/reports/feedback.xlsx — góp ý / phản hồi
   * ======================================================================== */
  app.get('/api/reports/feedback.xlsx', async (req, reply) => {
    assertPerm(req.user, 'export.self');

    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');

    const where = [`(f.created_at at time zone 'Asia/Ho_Chi_Minh')::date between $1 and $2`];
    const params = [from, to];
    let next = 3;

    if (isFieldStaff(req.user)) {
      // GV/TG chỉ xuất góp ý do chính mình gửi
      where.push(`f.created_by = $${next}`);
      params.push(req.user.id);
      next += 1;
    } else {
      const sf = await schoolFilter(req.user, 'f.school_id', next);
      where.push(sf.sql);
      params.push(...sf.params);
      next = sf.next;
      if (userId) { where.push(`f.created_by = $${next}`); params.push(userId); next += 1; }
    }
    if (schoolId) { where.push(`f.school_id = $${next}`); params.push(schoolId); next += 1; }
    if (classId)  { where.push(`f.class_id = $${next}`);  params.push(classId);  next += 1; }

    const data = await rows(
      `select f.created_at, f.title, f.category, f.priority, f.status, f.closed_at,
              sc.name as school_name, cu.full_name as creator_name, au.full_name as assignee_name
         from feedback f
         left join schools sc on sc.id = f.school_id
         join users cu on cu.id = f.created_by
         left join users au on au.id = f.assigned_to
        where ${where.join(' and ')}
        order by f.created_at desc`,
      params
    );

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất báo cáo góp ý ${formatVNDate(from)}–${formatVNDate(to)} (${data.length} dòng)`,
    });

    return sendXlsx(reply, {
      fileName: `gop-y-${from}-${to}`,
      title: 'BÁO CÁO GÓP Ý / PHẢN HỒI',
      subtitle: `Từ ${formatVNDate(from)} đến ${formatVNDate(to)}`,
      columns: [
        { header: 'Ngày', key: 'date', width: 14, align: 'center' },
        { header: 'Tiêu đề', key: 'title', width: 30, wrap: true },
        { header: 'Phân loại', key: 'category', width: 11, align: 'center' },
        { header: 'Ưu tiên', key: 'priority', width: 10, align: 'center' },
        { header: 'Trạng thái', key: 'status', width: 11, align: 'center' },
        { header: 'Trường', key: 'school', width: 24 },
        { header: 'Người gửi', key: 'creator', width: 20 },
        { header: 'Người xử lý', key: 'assignee', width: 20 },
        { header: 'Ngày đóng', key: 'closed', width: 14, align: 'center' },
      ],
      rows: data.map((f) => ({
        date: formatVN(f.created_at),
        title: f.title,
        category: LABELS.category[f.category] || f.category,
        priority: LABELS.priority[f.priority] || f.priority,
        status: LABELS.issue[f.status] || f.status,
        school: f.school_name || '',
        creator: f.creator_name,
        assignee: f.assignee_name || '',
        closed: formatVN(f.closed_at),
      })),
    });
  });

  /* ======================================================================== *
   * GET /api/reports/users.xlsx — danh sách tài khoản (export.all — chỉ admin)
   * ======================================================================== */
  app.get('/api/reports/users.xlsx', { preHandler: requirePerm('export.all') }, async (req, reply) => {
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');

    const where = ['true'];
    const params = [];
    let next = 1;

    // from/to CHỈ áp khi client truyền tường minh — dateRange mặc định là tháng
    // hiện tại, nếu áp mặc định sẽ vô tình ẩn gần hết tài khoản cũ.
    if (req.query.from || req.query.to) {
      const { from, to } = dateRange(req.query);
      where.push(`(u.created_at at time zone 'Asia/Ho_Chi_Minh')::date between $${next} and $${next + 1}`);
      params.push(from, to);
      next += 2;
    }
    if (userId) { where.push(`u.id = $${next}`); params.push(userId); next += 1; }
    if (schoolId) {
      where.push(
        `(exists (select 1 from user_schools us
                   where us.user_id = u.id and us.school_id = $${next})
          or exists (select 1 from class_assignments ca
                       join classes c on c.id = ca.class_id
                      where ca.user_id = u.id and c.school_id = $${next}))`
      );
      params.push(schoolId);
      next += 1;
    }
    if (classId) {
      where.push(
        `exists (select 1 from class_assignments ca
                  where ca.user_id = u.id and ca.class_id = $${next})`
      );
      params.push(classId);
      next += 1;
    }

    const data = await rows(
      `select u.full_name, u.email, u.phone, u.role, u.is_active, u.last_login_at, u.created_at,
              (select string_agg(s.name, ', ' order by s.name)
                 from user_schools us join schools s on s.id = us.school_id
                where us.user_id = u.id) as school_names,
              (select string_agg(distinct c.name || ' (' || s2.code || ')', ', ')
                 from class_assignments ca
                 join classes c on c.id = ca.class_id
                 join schools s2 on s2.id = c.school_id
                where ca.user_id = u.id) as class_names
         from users u
        where ${where.join(' and ')}
        order by u.role, u.full_name`,
      params
    );

    if (!isPreview(reply)) audit(req, {
      action: 'export',
      entity: 'reports',
      summary: `Xuất danh sách tài khoản (${data.length} người)`,
    });

    return sendXlsx(reply, {
      fileName: 'danh-sach-tai-khoan',
      title: 'DANH SÁCH TÀI KHOẢN',
      subtitle: 'Toàn hệ thống',
      columns: [
        { header: 'Họ tên', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'SĐT', key: 'phone', width: 13, align: 'center' },
        { header: 'Vai trò', key: 'role', width: 15, align: 'center' },
        { header: 'Trạng thái', key: 'status', width: 10, align: 'center' },
        { header: 'Trường phụ trách', key: 'schools', width: 34, wrap: true },
        { header: 'Lớp phụ trách', key: 'classes', width: 34, wrap: true },
        { header: 'Đăng nhập gần nhất', key: 'last_login', width: 16, align: 'center' },
        { header: 'Ngày tạo', key: 'created', width: 12, align: 'center' },
      ],
      rows: data.map((u) => ({
        name: u.full_name,
        email: u.email,
        phone: u.phone || '',
        role: LABELS.role[u.role] || u.role,
        status: u.is_active ? 'Hoạt động' : 'Khoá',
        schools: u.school_names || '',
        classes: u.class_names || '',
        last_login: formatVN(u.last_login_at),
        created: formatVNDate(u.created_at),
      })),
    });
  });
}
