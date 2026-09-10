/**
 * Dashboard.jsx — Trang chủ theo vai trò.
 *
 * - Giáo viên / Trợ giảng  → GET /api/reports/my-dashboard:
 *     buổi dạy hôm nay (kèm nút Check-in/Check-out/Điểm danh), việc cần làm,
 *     thống kê tháng của tôi.
 * - Quản trị / Phòng chuyên môn → GET /api/reports/dashboard:
 *     số liệu hôm nay, cảnh báo (GPS lệch, sự cố thiết bị, góp ý mới),
 *     danh sách buổi chưa điểm danh (nút Nhắc), sự cố gần đây.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoading, Spinner } from '../../components/ui.jsx';
import { LABEL, fmtAgo, fmtDateLong, fmtDuration, fmtNumber, fmtRange, fmtTime, today } from '../../lib/format.js';

/* ------------------------------- Tiện ích nhỏ ------------------------------ */

/** Lời chào theo giờ trong ngày. */
function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng ☀️';
  if (h < 13) return 'Chào buổi trưa 🍚';
  if (h < 18) return 'Chào buổi chiều 🌤️';
  return 'Chào buổi tối 🌙';
}

/** Lấy giá trị đầu tiên khác undefined trong các khoá dự phòng. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

/** Số lượng: chấp nhận mảng (đếm phần tử), object đếm theo trạng thái (cộng dồn), hoặc số. */
const num = (v) => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.values(v).reduce((a, x) => a + (Number(x) || 0), 0);
  return Number(v) || 0;
};

/** Ô số liệu nhỏ. */
function StatTile({ value, label, className = '' }) {
  const n = Number(value);
  return (
    <div className="card px-2 py-3 text-center">
      <div className={`text-[22px] font-extrabold leading-tight ${className}`}>
        {Number.isFinite(n) ? fmtNumber(n) : '—'}
      </div>
      <div className="text-[11.5px] text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

/** Tiêu đề khu vực, kèm liên kết "Xem tất cả" tuỳ chọn. */
function SectionTitle({ children, to, tight = false }) {
  return (
    <div className={`flex items-center justify-between mb-2 ${tight ? 'mt-0' : 'mt-5'}`}>
      <h2 className="text-[14px] font-bold text-ink">{children}</h2>
      {to && (
        <Link to={to} className="text-[12.5px] font-semibold text-brand-700 hover:underline">
          Xem tất cả ›
        </Link>
      )}
    </div>
  );
}

/* ===================== Giáo viên / Trợ giảng ===================== */

/** Thẻ một buổi dạy hôm nay. */
function SessionCard({ s }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const id = pick(s, 'schedule_id', 'id');
  const checkedIn = pick(s, 'checked_in_at', 'check_in_at', 'check_in_time', 'checkin_at');
  const checkedOut = pick(s, 'checked_out_at', 'check_out_at', 'check_out_time', 'checkout_at');
  const attendanceDone = pick(s, 'attendance_done', 'attendance_marked');
  const className = pick(s, 'class_name') ?? s.class?.name;
  const schoolName = pick(s, 'school_name') ?? s.school?.name;
  const roomName = pick(s, 'room_name') ?? s.room?.name;
  const label = s.label; // ontime | late | absent — server tính khi check-in

  const needAttendance = attendanceDone !== undefined && !attendanceDone;
  const showCheckBtn = auth.can('timesheet.self') && !checkedOut;
  const showAttBtn = auth.can('attendance.submit') && needAttendance;
  const complete = !!checkedOut && !!attendanceDone;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-[15px] text-brand-800">
            {fmtRange(pick(s, 'start_time', 'starts_at', 'start'), pick(s, 'end_time', 'ends_at', 'end'))}
          </div>
          <div className="font-semibold text-[14px] mt-0.5 truncate">{className || 'Lớp chưa rõ'}</div>
          <div className="text-[12.5px] text-ink-muted truncate">
            {schoolName || ''}{roomName ? ` · ${roomName}` : ''}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {checkedOut ? (
            <Badge tone="approved">Đã check-out</Badge>
          ) : checkedIn ? (
            <Badge tone="new">Đã check-in lúc {fmtTime(checkedIn)}</Badge>
          ) : (
            <Badge tone="pending">Chưa check-in</Badge>
          )}
          {label && LABEL.attend[label] && <Badge tone={label}>{LABEL.attend[label]}</Badge>}
        </div>
      </div>

      {(showCheckBtn || showAttBtn || complete) && (
        <div className="flex items-center gap-2 mt-3">
          {showCheckBtn && (
            <button className="btn-primary flex-1 !py-2" onClick={() => navigate(`/cham-cong/${id}`)}>
              📍 {checkedIn ? 'Check-out' : 'Check-in'}
            </button>
          )}
          {showAttBtn && (
            <button
              className={`${checkedOut ? 'btn-primary' : 'btn-line'} flex-1 !py-2`}
              onClick={() => navigate(`/diem-danh/${id}`)}>
              📋 Điểm danh
            </button>
          )}
          {complete && !showCheckBtn && !showAttBtn && (
            <div className="text-[12.5px] text-emerald-700 font-semibold py-1">✓ Buổi dạy đã hoàn tất</div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldDashboard({ data }) {
  const sessions = pick(data, 'today_sessions', 'today', 'sessions', 'schedules') || [];

  // "Việc cần làm" — chấp nhận cả dạng mảng lẫn dạng đếm.
  const rawTasks = data.pending_tasks;
  const tasks = [];
  if (Array.isArray(rawTasks)) {
    rawTasks.forEach((it, i) => {
      const sid = pick(it, 'schedule_id', 'id');
      const isAtt = /attendance|diem/i.test(String(pick(it, 'type', 'kind') || ''));
      tasks.push({
        key: `t${i}`,
        label: pick(it, 'label', 'message', 'title')
          || (isAtt ? 'Buổi dạy chưa điểm danh' : 'Buổi dạy chưa check-out'),
        to: sid ? (isAtt ? `/diem-danh/${sid}` : `/cham-cong/${sid}`) : (isAtt ? '/diem-danh' : '/cham-cong'),
      });
    });
  } else if (rawTasks && typeof rawTasks === 'object') {
    const notOut = num(pick(rawTasks, 'not_checked_out', 'missing_checkout', 'checkout'));
    const notAtt = num(pick(rawTasks, 'attendance_missing', 'not_attendance', 'missing_attendance', 'attendance', 'not_marked'));
    if (notOut > 0) tasks.push({ key: 'out', label: `${notOut} buổi chưa check-out`, to: '/cham-cong' });
    if (notAtt > 0) tasks.push({ key: 'att', label: `${notAtt} buổi chưa điểm danh`, to: '/diem-danh' });
  }

  const month = pick(data, 'month', 'my_month', 'month_stats', 'stats') || {};
  const minutes = pick(month, 'work_minutes', 'teaching_minutes', 'total_minutes', 'minutes', 'duration_minutes');

  return (
    <>
      {/* Buổi dạy hôm nay */}
      <SectionTitle to="/lich" tight>Buổi dạy hôm nay</SectionTitle>
      {sessions.length === 0 ? (
        <EmptyState
          icon="🌤️"
          title="Hôm nay bạn không có buổi dạy nào"
          hint="Mở mục Lịch dạy để xem lịch các ngày tới."
          action={<Link to="/lich" className="btn-line">🗓️ Xem lịch dạy</Link>}
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {sessions.map((s, i) => (
            <SessionCard key={pick(s, 'schedule_id', 'id') ?? i} s={s} />
          ))}
        </div>
      )}

      {/* Việc cần làm */}
      {tasks.length > 0 && (
        <div className="card border-amber-300 bg-amber-50/80 p-4 mt-4">
          <div className="font-bold text-[14px] text-amber-800 mb-2">⏰ Việc cần làm</div>
          <div className="grid gap-1.5">
            {tasks.map((t) => (
              <Link
                key={t.key}
                to={t.to}
                className="flex items-center justify-between rounded-xl bg-white/70 border border-amber-200 px-3 py-2 text-[13.5px] font-medium text-amber-900 hover:bg-white">
                <span>{t.label}</span>
                <span className="text-amber-500">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Thống kê tháng của tôi */}
      <SectionTitle>Tháng này của tôi</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
        <StatTile value={pick(month, 'sessions', 'total_sessions', 'taught_sessions') ?? 0} label="Buổi dạy" className="text-brand-700" />
        <StatTile value={pick(month, 'ontime', 'on_time') ?? 0} label="Đúng giờ" className="text-emerald-600" />
        <StatTile value={month.late ?? 0} label="Trễ" className="text-amber-600" />
        <StatTile value={month.absent ?? 0} label="Vắng" className="text-rose-600" />
      </div>
      <div className="card mt-2.5 px-4 py-3 flex items-center justify-between">
        <span className="text-[13.5px] text-ink-soft font-medium">⏱️ Tổng giờ dạy tháng này</span>
        <span className="font-bold text-brand-800">{fmtDuration(minutes)}</span>
      </div>
    </>
  );
}

/* ===================== Quản trị / Phòng chuyên môn ===================== */

function ManagerDashboard({ data }) {
  const auth = useAuth();
  const toast = useToast();
  const [remindingId, setRemindingId] = useState(null);
  const [reminded, setReminded] = useState(() => new Set());

  const t = data.today && typeof data.today === 'object' && !Array.isArray(data.today) ? data.today : data;
  const pendingList = Array.isArray(data.pending_attendance)
    ? data.pending_attendance
    : Array.isArray(t.pending_attendance) ? t.pending_attendance : [];

  const sessions = pick(t, 'sessions', 'total_sessions', 'schedules', 'sessions_today', 'today_sessions') ?? 0;
  const checkedIn = pick(t, 'checked_in', 'checkins', 'checked') ?? 0;
  const late = pick(t, 'late', 'late_count') ?? 0;
  let notMarked = pick(t, 'attendance_pending', 'not_marked', 'unmarked', 'pending_attendance_count', 'no_attendance');
  if (notMarked === undefined || Array.isArray(notMarked)) notMarked = pendingList.length;

  const flagged = num(pick(data, 'flagged_timesheets', 'gps_flagged'));
  const openIssues = num(pick(data, 'open_issues', 'device_issues_open'));
  const feedbackNew = num(pick(data, 'feedback_new', 'new_feedback'));

  const warnings = [];
  if (flagged > 0 && auth.can('timesheet.approve')) {
    warnings.push({ key: 'gps', to: '/cham-cong?duyet=1', icon: '🛰️', text: `${flagged} lượt check-in lệch GPS chờ duyệt` });
  }
  if (openIssues > 0) {
    warnings.push({ key: 'dev', to: '/thiet-bi', icon: '🛠️', text: `${openIssues} sự cố thiết bị đang mở` });
  }
  if (feedbackNew > 0) {
    warnings.push({ key: 'fb', to: '/gop-y', icon: '📨', text: `${feedbackNew} góp ý mới chưa xử lý` });
  }

  const issues = (Array.isArray(data.recent_issues) ? data.recent_issues : []).slice(0, 5);

  const remind = async (sid) => {
    if (!sid || remindingId) return;
    setRemindingId(sid);
    try {
      await api.post(`/api/attendance/${sid}/remind`);
      toast.ok('Đã gửi nhắc nhở');
      setReminded((prev) => new Set(prev).add(sid));
    } catch (e) {
      toast.fromError(e);
    } finally {
      setRemindingId(null);
    }
  };

  return (
    <>
      {/* Số liệu hôm nay */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
        <StatTile value={sessions} label="Buổi dạy hôm nay" className="text-brand-700" />
        <StatTile value={checkedIn} label="Đã check-in" className="text-emerald-600" />
        <StatTile value={late} label="Trễ" className="text-amber-600" />
        <StatTile value={notMarked} label="Chưa điểm danh" className="text-rose-600" />
      </div>

      {/* Cảnh báo */}
      {warnings.length > 0 && (
        <div className="card border-amber-300 bg-amber-50/80 p-4 mt-4">
          <div className="font-bold text-[14px] text-amber-800 mb-2">⚠️ Cần chú ý</div>
          <div className="grid gap-1.5">
            {warnings.map((w) => (
              <Link
                key={w.key}
                to={w.to}
                className="flex items-center justify-between rounded-xl bg-white/70 border border-amber-200 px-3 py-2 text-[13.5px] font-medium text-amber-900 hover:bg-white">
                <span>{w.icon} {w.text}</span>
                <span className="text-amber-500">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Buổi chưa điểm danh */}
      <SectionTitle to="/diem-danh">Buổi chưa điểm danh</SectionTitle>
      {pendingList.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Tất cả các buổi đã được điểm danh"
          hint="Buổi quá giờ mà chưa điểm danh sẽ hiện tại đây để bạn nhắc người phụ trách."
        />
      ) : (
        <div className="grid gap-2">
          {pendingList.map((p, i) => {
            const sid = pick(p, 'schedule_id', 'id');
            const teacher = pick(p, 'teacher_name', 'user_name', 'full_name') ?? p.teacher?.full_name;
            const done = reminded.has(sid);
            return (
              <div key={sid ?? i} className="card p-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14px] truncate">
                    {fmtRange(pick(p, 'start_time', 'starts_at'), pick(p, 'end_time', 'ends_at'))}
                    {' · '}
                    {pick(p, 'class_name') ?? p.class?.name ?? 'Lớp chưa rõ'}
                  </div>
                  <div className="text-[12.5px] text-ink-muted truncate">
                    {pick(p, 'school_name') ?? p.school?.name ?? ''}
                    {teacher ? ` · ${teacher}` : ''}
                  </div>
                </div>
                {auth.can('attendance.viewAll') && (
                  <button
                    className="btn-line !px-3 !py-1.5 shrink-0"
                    disabled={done || remindingId === sid}
                    onClick={() => remind(sid)}>
                    {remindingId === sid ? <Spinner className="h-4 w-4" /> : done ? '✓ Đã nhắc' : '🔔 Nhắc'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sự cố thiết bị gần đây */}
      <SectionTitle to="/thiet-bi">Sự cố thiết bị gần đây</SectionTitle>
      {issues.length === 0 ? (
        <div className="card px-4 py-3 text-[13.5px] text-ink-muted">Không có sự cố nào gần đây.</div>
      ) : (
        <div className="card divide-y divide-line">
          {issues.map((it, i) => (
            <div key={it.id ?? i} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">
                  {pick(it, 'title', 'name', 'description') || 'Sự cố thiết bị'}
                </div>
                <div className="text-[12px] text-ink-muted truncate">
                  {pick(it, 'school_name') ?? it.school?.name ?? ''}
                  {it.created_at ? ` · ${fmtAgo(it.created_at)}` : ''}
                </div>
              </div>
              {it.priority && it.priority !== 'normal' && LABEL.priority[it.priority] && (
                <Badge tone={it.priority}>{LABEL.priority[it.priority]}</Badge>
              )}
              {LABEL.issue[it.status] && <Badge tone={it.status}>{LABEL.issue[it.status]}</Badge>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ================================ Trang chủ ================================ */

export default function Dashboard() {
  const auth = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get(auth.isFieldStaff ? '/api/reports/my-dashboard' : '/api/reports/dashboard');
      setData(res || {});
    } catch (e) {
      setError(e);
    }
  }, [auth.isFieldStaff]);

  useEffect(() => { load(); }, [load]);

  const header = (
    <PageHeader
      title={`Xin chào, ${auth.user?.full_name || ''}!`}
      sub={`${greeting()} · ${fmtDateLong(today())}`}
    />
  );

  if (error && !data) return <>{header}<ErrorBox error={error} onRetry={load} /></>;
  if (!data) return <>{header}<PageLoading /></>;

  return (
    <>
      {header}
      {auth.isFieldStaff ? <FieldDashboard data={data} /> : <ManagerDashboard data={data} />}
    </>
  );
}
