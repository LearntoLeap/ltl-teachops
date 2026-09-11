/**
 * Dashboard.jsx — Trang chủ "bảng điều độ", MỖI VAI TRÒ MỘT BỐ CỤC RIÊNG:
 *
 * - Giáo viên / Trợ giảng  → GET /api/reports/my-dashboard
 *     "Vé buổi dạy": buổi kế tiếp là tấm vé lớn với 3 bước tuần tự
 *     Check-in → Điểm danh → Check-out; kèm việc tồn, lịch 7 ngày tới,
 *     hành động nhanh và thống kê tháng.
 *
 * - Phòng chuyên môn        → GET /api/reports/dashboard
 *     Nhịp vận hành hôm nay (thanh tiến độ điểm danh), hàng đợi xử lý
 *     (duyệt GPS / thiết bị / góp ý), buổi chưa điểm danh với nút Nhắc.
 *
 * - Quản trị viên           → GET /api/reports/admin-overview
 *     Sức khoẻ hệ thống: quy mô tổ chức, nhân sự theo vai trò, hàng đợi
 *     toàn hệ thống, nhật ký thao tác và tài khoản mới nhất.
 *
 * Quy ước hiển thị: nhãn mắt (eyebrow) mã màu theo LOẠI khu vực —
 * vàng = cần hành động ngay · tím = giám sát · xám = tham khảo.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { pendingCount } from '../../lib/offline.js';
import { useToast } from '../../components/Toast.jsx';
import { Badge, EmptyState, ErrorBox, PageLoading, Spinner } from '../../components/ui.jsx';
import {
  LABEL, fmtAgo, fmtDate, fmtDateLong, fmtDuration, fmtNumber,
  fmtRange, fmtTime, today,
} from '../../lib/format.js';

/* ================================ Dùng chung =============================== */

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng ☀️';
  if (h < 13) return 'Chào buổi trưa 🍚';
  if (h < 18) return 'Chào buổi chiều 🌤️';
  return 'Chào buổi tối 🌙';
}

/** Băng chào đầu trang; tone='gradient' cho người dạy hiện trường. */
function HeroBand({ tone = 'light', chip, children }) {
  const auth = useAuth();
  if (tone === 'gradient') {
    return (
      <div className="rise rounded-[22px] bg-brand-grad text-white px-5 py-4 shadow-card relative overflow-hidden">
        <div className="absolute -right-7 -top-9 text-[110px] opacity-[.12] select-none" aria-hidden>🤖</div>
        <div className="text-[12.5px] opacity-85">{greeting()} · {fmtDateLong(today())}</div>
        <div className="text-[21px] font-extrabold leading-tight mt-0.5">
          Xin chào, {auth.user?.full_name}!
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="text-[12.5px] text-ink-muted">{greeting()} · {fmtDateLong(today())}</div>
        <h1 className="text-[21px] font-extrabold leading-tight">Xin chào, {auth.user?.full_name}!</h1>
      </div>
      {chip && (
        <span className="rounded-full bg-brand-100 text-brand-800 px-3 py-1 text-[12px] font-bold">
          {chip}
        </span>
      )}
    </div>
  );
}

/** Tiêu đề khu vực với nhãn mắt mã màu. kind: act | watch | ref */
function Section({ kind = 'watch', title, to, toLabel = 'Xem tất cả ›', className = '' }) {
  return (
    <div className={`flex items-center justify-between mt-5 mb-2 ${className}`}>
      <span className={`eyebrow eyebrow-${kind}`}>{title}</span>
      {to && (
        <Link to={to} className="text-[12.5px] font-semibold text-brand-700 hover:underline">
          {toLabel}
        </Link>
      )}
    </div>
  );
}

/** Ô số liệu: chip icon + số lớn + nhãn (+ dòng phụ tuỳ chọn). */
function Tile({ icon, chipCls = 'bg-brand-50', num, numCls = 'text-brand-800', label, sub }) {
  const n = Number(num);
  return (
    <div className="tile">
      <span className={`tile-chip ${chipCls}`}>{icon}</span>
      <span className="min-w-0">
        <span className={`tile-num block ${numCls}`}>{Number.isFinite(n) ? fmtNumber(n) : '—'}</span>
        <span className="block text-[11.5px] text-ink-muted mt-0.5 truncate">{label}</span>
        {sub && <span className="block text-[11px] text-ink-muted/80 truncate">{sub}</span>}
      </span>
    </div>
  );
}

/** Hàng trong hàng đợi xử lý. */
function QueueRow({ icon, chipCls, label, sub, count, countCls = 'bg-rose-100 text-rose-700', to }) {
  return (
    <Link to={to} className="queue-row">
      <span className={`tile-chip ${chipCls}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold truncate">{label}</span>
        {sub && <span className="block text-[11.5px] text-ink-muted truncate">{sub}</span>}
      </span>
      {count > 0 && (
        <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-extrabold ${countCls}`}>
          {fmtNumber(count)}
        </span>
      )}
      <span className="text-ink-muted/60">›</span>
    </Link>
  );
}

/** Lưới hành động nhanh. */
function QuickActions({ items, className = '' }) {
  return (
    <div className={`grid grid-cols-4 gap-2 ${className}`}>
      {items.map((a) => (
        <Link key={a.label} to={a.to} className="qa">
          <span className="qa-ic">{a.icon}</span>
          {a.label}
        </Link>
      ))}
    </div>
  );
}

/* ===================== 1) GIÁO VIÊN / TRỢ GIẢNG ===================== */

/** Trạng thái 3 bước của một buổi: check-in → điểm danh → check-out. */
function sessionSteps(s) {
  const steps = [
    { key: 'in', label: 'Check-in', done: !!s.check_in_at, at: s.check_in_at, to: 'cham-cong' },
    { key: 'att', label: 'Điểm danh', done: !!s.attendance_done, to: 'diem-danh' },
    { key: 'out', label: 'Check-out', done: !!s.check_out_at, at: s.check_out_at, to: 'cham-cong' },
  ];
  const current = steps.find((st) => !st.done) || null;
  return { steps, current, complete: !current };
}

/** VÉ BUỔI DẠY — thẻ chủ đạo của người dạy: khối giờ + mép đục lỗ + 3 bước. */
function SessionTicket({ s }) {
  const navigate = useNavigate();
  const { steps, current, complete } = sessionSteps(s);
  const id = s.id || s.schedule_id;

  const CTA = {
    in: { label: '📍 Check-in ngay', to: `/cham-cong/${id}` },
    att: { label: '📋 Điểm danh lớp', to: `/diem-danh/${id}` },
    out: { label: '🏁 Check-out kết thúc buổi', to: `/cham-cong/${id}` },
  }[current?.key];

  return (
    <div className="ticket rise rise-1">
      {/* Khối giờ — cuống vé */}
      <div className="w-[104px] shrink-0 bg-brand-grad text-white px-3 py-4 flex flex-col justify-center items-center text-center">
        <div className="text-[24px] font-extrabold leading-none tracking-tight">{fmtTime(s.start_time)}</div>
        <div className="text-[12px] opacity-85 mt-1">– {fmtTime(s.end_time)}</div>
        <div className="text-[10.5px] opacity-75 mt-2">{fmtDate(s.session_date || today())}</div>
      </div>
      <div className="ticket-perf" aria-hidden />

      {/* Nội dung vé */}
      <div className="flex-1 min-w-0 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold text-[16px] truncate">Lớp {s.class_name || '?'}</div>
            <div className="text-[12.5px] text-ink-muted truncate">
              {s.school_name}{s.room_name ? ` · ${s.room_name}` : ''}
              {s.subject ? ` · ${s.subject}` : ''}
            </div>
          </div>
          {s.label === 'late' && <Badge tone="late">Trễ {s.late_minutes > 0 ? `${s.late_minutes}p` : ''}</Badge>}
          {complete && <Badge tone="approved">Hoàn tất</Badge>}
        </div>

        {/* Rãnh 3 bước tuần tự */}
        <ol className="mt-3 grid gap-1.5">
          {steps.map((st, i) => {
            const isCurrent = current?.key === st.key;
            return (
              <li key={st.key} className="flex items-center gap-2.5">
                <span className={`h-[22px] w-[22px] rounded-full grid place-items-center text-[11px] font-extrabold shrink-0
                  ${st.done ? 'bg-emerald-500 text-white'
                    : isCurrent ? 'bg-brand-grad text-white shadow-card-sm'
                    : 'bg-line text-ink-muted'}`}>
                  {st.done ? '✓' : i + 1}
                </span>
                <span className={`text-[13px] ${st.done ? 'text-ink-muted line-through decoration-emerald-300'
                  : isCurrent ? 'font-bold text-ink' : 'text-ink-muted'}`}>
                  {st.label}
                </span>
                {st.at && <span className="text-[11.5px] text-emerald-600 font-semibold">{fmtTime(st.at)}</span>}
                {isCurrent && <span className="text-[10.5px] font-bold text-brand-700 bg-brand-50 rounded-full px-2 py-[1px]">bước tiếp theo</span>}
              </li>
            );
          })}
        </ol>

        {CTA && (
          <button className="btn-primary w-full mt-3 !py-2.5" onClick={() => navigate(CTA.to)}>
            {CTA.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** Thẻ gọn cho các buổi còn lại trong ngày. */
function SessionRow({ s }) {
  const navigate = useNavigate();
  const { current, complete } = sessionSteps(s);
  const id = s.id || s.schedule_id;
  return (
    <button
      onClick={() => navigate(current?.to === 'diem-danh' ? `/diem-danh/${id}` : `/cham-cong/${id}`)}
      className="card w-full p-3 flex items-center gap-3 text-left hover:border-brand-300 transition">
      <span className="w-[52px] shrink-0 text-center">
        <span className="block text-[15px] font-extrabold text-brand-800 leading-none">{fmtTime(s.start_time)}</span>
        <span className="block text-[10.5px] text-ink-muted mt-0.5">{fmtTime(s.end_time)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold truncate">Lớp {s.class_name}</span>
        <span className="block text-[11.5px] text-ink-muted truncate">{s.school_name}</span>
      </span>
      {complete
        ? <Badge tone="approved">✓ Xong</Badge>
        : <Badge tone={current?.key === 'in' ? 'pending' : 'new'}>{current?.label}</Badge>}
    </button>
  );
}

/** Bảng lịch tuần rút gọn: 7 cột, mỗi ô liệt kê các tiết của ngày đó. */
function MyWeekBoard({ from, items }) {
  const todayIso = today();
  const days = [];
  const base = new Date(`${from}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const p = (x) => String(x).padStart(2, '0');
    days.push({
      iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      label: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][i],
      dayNum: d.getDate(),
    });
  }

  const byDay = new Map();
  for (const s of items || []) {
    const k = String(s.session_date || '').slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }

  return (
    <div className="rise rise-4 card overflow-hidden">
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d.iso) || [];
          const isToday = d.iso === todayIso;
          return (
            <div key={d.iso}
              className={`min-h-[92px] border-r border-b border-line/70 last:border-r-0 p-1.5
                ${isToday ? 'bg-brand-50/50' : ''}`}>
              <div className="text-center mb-1">
                <span className={`inline-grid place-items-center h-6 w-6 rounded-full text-[11px] font-extrabold
                  ${isToday ? 'bg-brand-grad text-white' : 'text-ink-soft'}`}>
                  {d.dayNum}
                </span>
                <span className="block text-[10px] font-bold uppercase text-ink-muted">{d.label}</span>
              </div>
              <div className="grid gap-1">
                {list.slice(0, 3).map((s) => (
                  <Link key={s.id} to={`/cham-cong/${s.id}`}
                    title={`${fmtTime(s.start_time)} · Lớp ${s.class_name} — ${s.school_name}`}
                    className="block rounded-md bg-white ring-1 ring-inset ring-brand-100 px-1 py-[3px]
                               text-[10px] font-bold text-brand-900 text-center truncate hover:bg-brand-100">
                    {fmtTime(s.start_time)}
                    <span className="block font-semibold text-ink-muted truncate">{s.class_name}</span>
                  </Link>
                ))}
                {list.length > 3 && (
                  <span className="block text-[9.5px] text-ink-muted text-center">+{list.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 text-[11px] text-ink-muted bg-canvas/60 border-t border-line">
        Tổng <b>{(items || []).length}</b> tiết trong tuần · bấm một tiết để chấm công
      </div>
    </div>
  );
}

function FieldDashboard({ data }) {
  const [week, setWeek] = useState([]);
  const [weekRange, setWeekRange] = useState(null);
  const [queued, setQueued] = useState(0);

  // Lịch TUẦN NÀY (Thứ Hai → Chủ nhật) + số mục chờ đồng bộ.
  useEffect(() => {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const base = new Date();
    const mon = new Date(base);
    mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const from = iso(mon);
    const to = iso(sun);
    setWeekRange({ from, to });
    api.get('/api/schedules', { from, to, limit: 100 })
      .then((r) => setWeek((r?.items || []).filter((x) => x.status !== 'cancelled')))
      .catch(() => {});
    pendingCount().then(setQueued).catch(() => {});
  }, []);

  const sessions = [...(data.today_sessions || [])].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const focusIdx = sessions.findIndex((s) => !sessionSteps(s).complete);
  const focus = focusIdx >= 0 ? sessions[focusIdx] : null;
  const rest = sessions.filter((_, i) => i !== focusIdx);

  const tasks = [];
  const pt = data.pending_tasks || {};
  if (queued > 0) tasks.push({ key: 'sync', label: `${queued} thao tác chờ đồng bộ lên máy chủ`, to: '/cho-dong-bo' });
  if (pt.not_checked_out > 0) tasks.push({ key: 'out', label: `${pt.not_checked_out} buổi chưa check-out`, to: '/cham-cong' });
  if (pt.attendance_missing > 0) tasks.push({ key: 'att', label: `${pt.attendance_missing} buổi chưa điểm danh`, to: '/diem-danh' });

  const m = data.my_month || {};

  return (
    <>
      <HeroBand tone="gradient">
        <div className="text-[12.5px] mt-1 opacity-90">
          {sessions.length > 0
            ? `Hôm nay bạn có ${sessions.length} buổi dạy${focus ? ` — bước tiếp theo: ${sessionSteps(focus).current?.label}` : ' — đã hoàn tất cả 🎉'}`
            : 'Hôm nay không có buổi dạy — xem trước lịch tuần bên dưới nhé.'}
        </div>
      </HeroBand>

      {/* Việc tồn — luôn nổi lên đầu vì cần hành động */}
      {tasks.length > 0 && (
        <div className="rise rise-1 card border-amber-300 bg-amber-50/80 p-3.5 mt-3.5">
          <div className="eyebrow eyebrow-act mb-2">Việc cần làm ngay</div>
          <div className="grid gap-1.5">
            {tasks.map((t) => (
              <Link key={t.key} to={t.to}
                className="flex items-center justify-between rounded-xl bg-white/80 border border-amber-200 px-3 py-2 text-[13.5px] font-medium text-amber-900 hover:bg-white">
                <span>{t.label}</span><span className="text-amber-500">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Vé buổi kế tiếp */}
      {focus && (
        <>
          <Section kind="act" title="Buổi dạy kế tiếp" to="/lich" />
          <SessionTicket s={focus} />
        </>
      )}
      {sessions.length > 0 && (
        <>
          <Section kind="watch" title={`Các tiết hôm nay (${sessions.length} tiết)`} to="/lich" />
          <div className="rise rise-2 card divide-y divide-line overflow-hidden">
            {sessions.map((s, i) => {
              const st = sessionSteps(s);
              const isFocus = focus && (s.id || s.schedule_id) === (focus.id || focus.schedule_id);
              return (
                <Link
                  key={s.id || s.schedule_id}
                  to={st.current?.to === 'diem-danh'
                    ? `/diem-danh/${s.id || s.schedule_id}`
                    : `/cham-cong/${s.id || s.schedule_id}`}
                  className={`flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-brand-50/50
                    ${isFocus ? 'bg-brand-50/60' : ''}`}>
                  <span className={`h-7 w-7 rounded-lg grid place-items-center text-[12px] font-extrabold shrink-0
                    ${st.complete ? 'bg-emerald-500 text-white'
                      : isFocus ? 'bg-brand-grad text-white' : 'bg-brand-50 text-brand-800'}`}>
                    {st.complete ? '✓' : i + 1}
                  </span>
                  <span className="w-[86px] shrink-0">
                    <span className="block text-[13.5px] font-extrabold text-brand-800 leading-none">
                      {fmtTime(s.start_time)}
                    </span>
                    <span className="block text-[10.5px] text-ink-muted mt-0.5">
                      đến {fmtTime(s.end_time)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold truncate">
                      Tiết {i + 1} · Lớp {s.class_name}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted truncate">
                      {s.school_name}{s.room_name ? ` · ${s.room_name}` : ''}{s.subject ? ` · ${s.subject}` : ''}
                    </span>
                  </span>
                  {st.complete
                    ? <Badge tone="approved">Xong</Badge>
                    : <Badge tone={st.current?.key === 'in' ? 'pending' : 'new'}>{st.current?.label}</Badge>}
                </Link>
              );
            })}
          </div>
        </>
      )}
      {sessions.length === 0 && (
        <div className="rise rise-2 mt-3.5">
          <EmptyState icon="🌤️" title="Hôm nay bạn không có buổi dạy nào"
            hint="Tận hưởng ngày nghỉ, hoặc xem trước học liệu cho tuần tới." />
        </div>
      )}

      {/* Hành động nhanh */}
      <Section kind="ref" title="Hành động nhanh" />
      <QuickActions className="rise rise-3" items={[
        { icon: '📋', label: 'Điểm danh', to: '/diem-danh' },
        { icon: '🛠️', label: 'Báo hỏng', to: '/thiet-bi' },
        { icon: '📚', label: 'Học liệu', to: '/hoc-lieu' },
        { icon: '📨', label: 'Gửi góp ý', to: '/gop-y' },
      ]} />

      {/* Lịch tuần này — bảng 7 cột để bao quát cả tuần */}
      {weekRange && (
        <>
          <Section kind="ref" title="Lịch dạy tuần này" to="/lich" toLabel="Thời khoá biểu ›" />
          <MyWeekBoard from={weekRange.from} items={week} />
        </>
      )}

      {/* Tháng của tôi */}
      <Section kind="ref" title="Tháng này của tôi" />
      <div className="rise rise-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile icon="🗓️" num={m.sessions ?? 0} label="Buổi dạy" />
        <Tile icon="✅" chipCls="bg-emerald-50" numCls="text-emerald-600" num={m.ontime ?? 0} label="Đúng giờ" />
        <Tile icon="⏱️" chipCls="bg-amber-50" numCls="text-amber-600" num={m.late ?? 0} label="Trễ" />
        <Tile icon="🚫" chipCls="bg-rose-50" numCls="text-rose-600" num={m.absent ?? 0} label="Vắng" />
      </div>
      <div className="rise rise-6 card mt-2 px-4 py-3 flex items-center justify-between">
        <span className="text-[13.5px] text-ink-soft font-medium">⏱️ Tổng giờ dạy tháng này</span>
        <span className="font-extrabold text-brand-800">{fmtDuration(m.work_minutes)}</span>
      </div>
    </>
  );
}

/* ===================== 2) PHÒNG CHUYÊN MÔN ===================== */

function ManagerDashboard({ data }) {
  const auth = useAuth();
  const toast = useToast();
  const [remindingId, setRemindingId] = useState(null);
  const [reminded, setReminded] = useState(() => new Set());

  const t = data.today || {};
  const issues = data.open_issues || {};
  const openTotal = (issues.new || 0) + (issues.in_progress || 0);
  const pendingList = data.pending_attendance || [];
  const recentIssues = (data.recent_issues || []).slice(0, 5);

  // Tiến độ điểm danh hôm nay (chỉ các buổi đã tới giờ mới tính "chưa điểm danh").
  const attDone = t.attendance_done || 0;
  const attPending = t.attendance_pending || 0;
  const attRest = Math.max(0, (t.sessions || 0) - attDone - attPending);

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
      <HeroBand chip={auth.schools.length ? `${auth.schools.length} trường phụ trách` : 'Toàn bộ trường'} />

      {/* Nhịp vận hành hôm nay */}
      <Section kind="watch" title="Nhịp vận hành hôm nay" to="/bao-cao" toLabel="Báo cáo ›" className="!mt-4" />
      <div className="rise rise-1 grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tile icon="🗓️" num={t.sessions ?? 0} label="Buổi dạy hôm nay" />
        <Tile icon="✅" chipCls="bg-emerald-50" numCls="text-emerald-600" num={t.checked_in ?? 0}
          label="Đã check-in" sub={`đúng giờ ${t.ontime ?? 0} · trễ ${t.late ?? 0}`} />
        <Tile icon="⏱️" chipCls="bg-amber-50" numCls="text-amber-600" num={t.late ?? 0} label="Check-in trễ" />
        <Tile icon="🚫" chipCls="bg-rose-50" numCls="text-rose-600" num={t.absent ?? 0} label="Vắng (buổi đã qua)" />
      </div>

      <div className="rise rise-2 card px-4 py-3 mt-2">
        <div className="flex items-center justify-between text-[12.5px] font-semibold mb-1.5">
          <span className="text-ink-soft">Điểm danh học sinh hôm nay</span>
          <span className="text-brand-800">{attDone}/{t.sessions ?? 0} buổi</span>
        </div>
        <div className="pulse">
          {t.sessions > 0 && (
            <>
              <span className="bg-emerald-500" style={{ width: `${(attDone / t.sessions) * 100}%` }} />
              <span className="bg-amber-400" style={{ width: `${(attPending / t.sessions) * 100}%` }} />
              <span className="bg-slate-200" style={{ width: `${(attRest / t.sessions) * 100}%` }} />
            </>
          )}
        </div>
        <div className="flex gap-4 mt-1.5 text-[11px] text-ink-muted">
          <span>● <b className="text-emerald-600">{attDone}</b> đã điểm danh</span>
          <span>● <b className="text-amber-600">{attPending}</b> quá giờ chưa làm</span>
          <span>● <b>{attRest}</b> chưa tới giờ</span>
        </div>
      </div>

      {/* Hàng đợi xử lý */}
      <Section kind="act" title="Hàng đợi cần xử lý" />
      <div className="rise rise-3 card divide-y divide-line overflow-hidden">
        {auth.can('timesheet.approve') && (
          <QueueRow icon="🛰️" chipCls="bg-rose-50" to="/cham-cong?duyet=1"
            label="Duyệt check-in lệch vị trí GPS" sub="Ngoài bán kính cho phép — cần bạn xác nhận tay"
            count={data.flagged_timesheets || 0} />
        )}
        <QueueRow icon="🛠️" chipCls="bg-amber-50" to="/thiet-bi"
          label="Sự cố thiết bị đang mở" sub={`mới ${issues.new || 0} · đang xử lý ${issues.in_progress || 0}`}
          count={openTotal} countCls="bg-amber-100 text-amber-700" />
        <QueueRow icon="📨" chipCls="bg-sky-50" to="/gop-y"
          label="Góp ý mới từ giáo viên" sub="Giáo trình, thiết bị, đề xuất khác"
          count={data.feedback_new || 0} countCls="bg-sky-100 text-sky-700" />
      </div>

      {/* Buổi chưa điểm danh */}
      <Section kind="act" title="Buổi quá giờ chưa điểm danh" to="/diem-danh" />
      {pendingList.length === 0 ? (
        <div className="rise rise-4 card px-4 py-3 text-[13.5px] text-ink-muted">
          ✅ Tất cả các buổi đã tới giờ đều được điểm danh.
        </div>
      ) : (
        <div className="rise rise-4 grid gap-2">
          {pendingList.map((p, i) => {
            const sid = p.schedule_id || p.id;
            const done = reminded.has(sid);
            return (
              <div key={sid ?? i} className="card p-3 flex items-center gap-3">
                <span className="w-[52px] shrink-0 text-center">
                  <span className="block text-[15px] font-extrabold text-rose-600 leading-none">{fmtTime(p.start_time)}</span>
                  <span className="block text-[10px] text-ink-muted mt-0.5">{fmtDate(p.session_date)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold truncate">Lớp {p.class_name}</span>
                  <span className="block text-[11.5px] text-ink-muted truncate">
                    {p.school_name}{p.teacher_name ? ` · GV ${p.teacher_name}` : ''}
                  </span>
                </span>
                <button className="btn-line !px-3 !py-1.5 shrink-0"
                  disabled={done || remindingId === sid}
                  onClick={() => remind(sid)}>
                  {remindingId === sid ? <Spinner className="h-4 w-4" /> : done ? '✓ Đã nhắc' : '🔔 Nhắc'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Sự cố gần đây + hành động nhanh */}
      <div className="grid lg:grid-cols-2 gap-x-4">
        <div>
          <Section kind="ref" title="Sự cố thiết bị gần đây" to="/thiet-bi" />
          {recentIssues.length === 0 ? (
            <div className="rise rise-5 card px-4 py-3 text-[13.5px] text-ink-muted">Không có sự cố nào gần đây.</div>
          ) : (
            <div className="rise rise-5 card divide-y divide-line">
              {recentIssues.map((it, i) => (
                <div key={it.id ?? i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    it.priority === 'urgent' ? 'bg-rose-500' : it.priority === 'high' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium truncate">
                      {it.device_name || 'Thiết bị'} — {it.description || ''}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted truncate">
                      {it.school_name}{it.room_name ? ` · ${it.room_name}` : ''} · {fmtAgo(it.created_at)}
                    </span>
                  </span>
                  {LABEL.issue[it.status] && <Badge tone={it.status}>{LABEL.issue[it.status]}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Section kind="ref" title="Hành động nhanh" />
          <QuickActions className="rise rise-6" items={[
            { icon: '➕', label: 'Thêm buổi', to: '/lich' },
            { icon: '🔁', label: 'Lịch lặp tuần', to: '/lich' },
            { icon: '✅', label: 'Duyệt học liệu', to: '/hoc-lieu' },
            { icon: '📤', label: 'Xuất Excel', to: '/bao-cao' },
          ]} />
        </div>
      </div>
    </>
  );
}

/* ===================== 3) QUẢN TRỊ VIÊN ===================== */

const AUDIT_ICON = {
  create: '➕', update: '✏️', delete: '🗑️', cancel: '🚫',
  approve: '✅', reject: '⛔', login: '🔑', export: '📤',
};

function AdminDashboard({ data }) {
  const org = data.org || {};
  const staff = data.staff || {};
  const q = data.queues || {};
  const issues = q.open_issues || {};
  const openTotal = (issues.new || 0) + (issues.in_progress || 0);
  const auditRows = (data.recent_audit || []).slice(0, 6);
  const newUsers = (data.recent_users || []).slice(0, 5);

  return (
    <>
      <HeroBand chip="Toàn hệ thống" />

      {/* Quy mô tổ chức */}
      <Section kind="watch" title="Quy mô hệ thống" to="/to-chuc" className="!mt-4" />
      <div className="rise rise-1 grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tile icon="🏫" num={org.schools} label="Trường đang hoạt động" />
        <Tile icon="🎓" chipCls="bg-sky-50" numCls="text-sky-700" num={org.classes} label="Lớp" />
        <Tile icon="🤖" chipCls="bg-emerald-50" numCls="text-emerald-600" num={org.rooms} label="Phòng STEM" />
        <Tile icon="🗓️" chipCls="bg-amber-50" numCls="text-amber-600" num={org.week_sessions}
          label="Buổi dạy tuần này" sub={`hôm nay ${org.today_sessions ?? 0} buổi`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-x-4 items-start">
        {/* Nhân sự */}
        <div>
          <Section kind="watch" title="Nhân sự vận hành" to="/tai-khoan" toLabel="Quản lý ›" />
          <div className="rise rise-2 card divide-y divide-line">
            {[
              ['admin', '🛡️', 'bg-amber-50'],
              ['manager', '🧭', 'bg-sky-50'],
              ['teacher', '🧑‍🏫', 'bg-emerald-50'],
              ['assistant', '🤝', 'bg-brand-50'],
            ].map(([role, ic, chip]) => (
              <div key={role} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className={`tile-chip ${chip}`}>{ic}</span>
                <span className="flex-1 text-[13.5px] font-semibold">{LABEL.role[role]}</span>
                <span className="tile-num !text-[18px] text-ink">{fmtNumber(staff[role] ?? 0)}</span>
              </div>
            ))}
            <Link to="/tai-khoan" className="queue-row !py-3 text-brand-700 font-bold text-[13.5px] justify-center">
              ➕ Tạo tài khoản mới
            </Link>
          </div>
        </div>

        {/* Hàng đợi toàn hệ thống */}
        <div>
          <Section kind="act" title="Hàng đợi toàn hệ thống" />
          <div className="rise rise-3 card divide-y divide-line overflow-hidden">
            <QueueRow icon="🛰️" chipCls="bg-rose-50" to="/cham-cong?duyet=1"
              label="Check-in lệch GPS chờ duyệt" count={q.flagged_timesheets || 0} />
            <QueueRow icon="🛠️" chipCls="bg-amber-50" to="/thiet-bi"
              label="Sự cố thiết bị đang mở" sub={`mới ${issues.new || 0} · đang xử lý ${issues.in_progress || 0}`}
              count={openTotal} countCls="bg-amber-100 text-amber-700" />
            <QueueRow icon="📨" chipCls="bg-sky-50" to="/gop-y"
              label="Góp ý mới chưa xử lý" count={q.feedback_new || 0} countCls="bg-sky-100 text-sky-700" />
            <QueueRow icon="📚" chipCls="bg-brand-50" to="/hoc-lieu"
              label="Slide giáo viên chờ duyệt" count={q.materials_pending || 0} countCls="bg-brand-100 text-brand-800" />
          </div>

          <Section kind="ref" title="Hành động nhanh" />
          <QuickActions className="rise rise-4" items={[
            { icon: '👥', label: '+ Tài khoản', to: '/tai-khoan' },
            { icon: '🏫', label: '+ Trường', to: '/to-chuc' },
            { icon: '💰', label: 'Xuất bảng lương', to: '/bao-cao' },
            { icon: '🧾', label: 'Nhật ký', to: '/nhat-ky' },
          ]} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-x-4 items-start">
        {/* Nhật ký gần đây */}
        <div>
          <Section kind="ref" title="Thao tác gần đây" to="/nhat-ky" />
          {auditRows.length === 0 ? (
            <div className="rise rise-5 card px-4 py-3 text-[13.5px] text-ink-muted">Chưa có thao tác nào được ghi.</div>
          ) : (
            <div className="rise rise-5 card divide-y divide-line">
              {auditRows.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <span className="text-[14px] mt-px">{AUDIT_ICON[a.action] || '•'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug text-ink-soft">
                      <b className="text-ink">{a.actor_name || 'Hệ thống'}</b> — {a.summary || `${a.action} ${a.entity}`}
                    </span>
                    <span className="block text-[11px] text-ink-muted mt-0.5">{fmtAgo(a.created_at)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tài khoản mới */}
        <div>
          <Section kind="ref" title="Tài khoản mới nhất" to="/tai-khoan" />
          <div className="rise rise-6 card divide-y divide-line">
            {newUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="h-8 w-8 rounded-full bg-brand-grad-soft text-white grid place-items-center text-[12.5px] font-bold shrink-0">
                  {(u.full_name || '?').trim().split(/\s+/).pop()[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold truncate">{u.full_name}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {LABEL.role[u.role]} · tạo {fmtAgo(u.created_at)}
                  </span>
                </span>
                {!u.last_login_at && <Badge tone="pending">Chưa đăng nhập</Badge>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ================================ Trang chủ ================================ */

export default function Dashboard() {
  const auth = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const endpoint = auth.isAdmin
    ? '/api/reports/admin-overview'
    : auth.isFieldStaff ? '/api/reports/my-dashboard' : '/api/reports/dashboard';

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await api.get(endpoint)) || {});
    } catch (e) {
      setError(e);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <PageLoading />;

  if (auth.isAdmin) return <AdminDashboard data={data} />;
  if (auth.isFieldStaff) return <FieldDashboard data={data} />;
  return <ManagerDashboard data={data} />;
}
