/**
 * Dashboard.jsx — Trang chủ "bảng điều độ", MỖI VAI TRÒ MỘT BỐ CỤC RIÊNG:
 *
 * - Giáo viên / Trợ giảng  → GET /api/reports/my-dashboard
 *     "Tiết dạy kế tiếp" (chỉ gợi ý) + TẤT CẢ tiết trong ngày gom theo buổi
 *     (tiết 1–5 sáng, 6+ chiều), mỗi buổi một nút chấm công vào/ra; kèm việc
 *     tồn, lịch tuần, hành động nhanh và thống kê tháng.
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
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { pendingCount } from '../../lib/offline.js';
import { useToast } from '../../components/Toast.jsx';
import { Badge, EmptyState, ErrorBox, PageLoading, Spinner } from '../../components/ui.jsx';
import {
  LABEL, fmtAgo, fmtDate, fmtDateLong, fmtDuration, fmtNumber,
  fmtTime, today,
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
        <div className="text-sm opacity-85">{greeting()} · {fmtDateLong(today())}</div>
        <div className="text-xl font-extrabold leading-tight mt-0.5">
          Xin chào, {auth.user?.full_name}!
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="text-sm text-ink-muted">{greeting()} · {fmtDateLong(today())}</div>
        <h1 className="text-xl font-extrabold leading-tight">Xin chào, {auth.user?.full_name}!</h1>
      </div>
      {chip && (
        <span className="rounded-full bg-brand-100 text-brand-800 px-3 py-1 text-xs font-bold">
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
        <Link to={to} className="text-sm font-semibold text-brand-700 hover:underline">
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
        <span className="block text-xs text-ink-muted mt-0.5 truncate">{label}</span>
        {sub && <span className="block text-xs text-ink-muted/80 truncate">{sub}</span>}
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
        <span className="block text-sm font-semibold truncate">{label}</span>
        {sub && <span className="block text-xs text-ink-muted truncate">{sub}</span>}
      </span>
      {count > 0 && (
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-extrabold ${countCls}`}>
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
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${className}`}>
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

/*
 * Hai việc tách bạch:
 * - CHẤM CÔNG theo BUỔI: tiết 1–5 là buổi sáng, tiết 6 trở đi là buổi chiều.
 *   Mỗi buổi ở mỗi trường chỉ chấm công vào 1 lần, ra 1 lần.
 * - Các TIẾT trong ngày chỉ là GỢI Ý để giáo viên nắm lịch (không phải nút bấm);
 *   điểm danh sĩ số từng tiết làm ở mục Điểm danh.
 */

const SESSION_META = {
  morning: { icon: '☀️', label: 'Buổi sáng', range: 'tiết 1–5' },
  afternoon: { icon: '🌤️', label: 'Buổi chiều', range: 'tiết 6 trở đi' },
};

const toMin = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Tiết có cần dạy không (huỷ lịch / đã bỏ thì không). */
const isActive = (s) => s.status !== 'cancelled' && s.status !== 'skipped';

/** Trạng thái hiển thị của một tiết theo giờ hiện tại. */
function tietState(s, now, nextId) {
  if (s.status === 'cancelled') return { key: 'cancelled', text: 'Huỷ lịch', cls: 'bg-zinc-100 text-ink-muted' };
  if (s.status === 'skipped') return { key: 'skipped', text: 'Đã bỏ', cls: 'bg-zinc-100 text-ink-muted' };
  if (s.attendance_done) {
    return {
      key: 'done',
      text: s.present_count != null ? `✓ ${s.present_count}/${s.roster_size ?? '—'} HS` : '✓ Đã điểm danh',
      cls: 'bg-emerald-50 text-emerald-700',
    };
  }
  const a = toMin(s.start_time);
  const b = toMin(s.end_time);
  if (a != null && b != null && now >= a && now < b) return { key: 'live', text: '● Đang diễn ra', cls: 'bg-brand-600 text-white' };
  if (b != null && now >= b) return { key: 'missed', text: 'Chưa điểm danh', cls: 'bg-amber-100 text-amber-800' };
  if (s.id === nextId) return { key: 'next', text: 'Kế tiếp', cls: 'bg-brand-100 text-brand-800' };
  return { key: 'later', text: 'Chưa tới giờ', cls: 'bg-zinc-100 text-ink-muted' };
}

/** Tiết đang dạy, nếu không thì tiết sắp tới gần nhất (chưa điểm danh). */
function pickNext(sessions, now) {
  const open = sessions.filter((s) => isActive(s) && !s.attendance_done);
  const live = open.find((s) => toMin(s.start_time) <= now && now < toMin(s.end_time));
  if (live) return { s: live, live: true };
  const up = open.find((s) => toMin(s.start_time) > now);
  return up ? { s: up, live: false } : null;
}

/** Gom tiết theo (trường, buổi) và ghép bản ghi chấm công của buổi đó. */
function groupByShift(sessions, shifts) {
  const map = new Map();
  const keyOf = (schoolId, session) => `${schoolId}|${session}`;
  for (const s of sessions) {
    const k = keyOf(s.school_id, s.work_session);
    if (!map.has(k)) {
      map.set(k, { key: k, school_id: s.school_id, school_name: s.school_name, session: s.work_session, items: [], shift: null });
    }
    map.get(k).items.push(s);
  }
  for (const t of shifts) {
    const k = keyOf(t.school_id, t.work_session);
    if (!map.has(k)) {
      map.set(k, { key: k, school_id: t.school_id, school_name: t.school_name, session: t.work_session, items: [], shift: null });
    }
    map.get(k).shift = t;
  }
  return [...map.values()].sort((x, y) => (x.session === y.session
    ? String(x.school_name).localeCompare(String(y.school_name), 'vi')
    : x.session === 'morning' ? -1 : 1));
}

const tietLabel = (s) => (s.period ? `Tiết ${s.period}` : fmtTime(s.start_time));

/** TIẾT DẠY KẾ TIẾP — chỉ gợi ý, không phải nút bấm. */
function NextTietCard({ next, now }) {
  if (!next) {
    return (
      <div className="rise rise-1 card px-4 py-3.5 text-sm text-ink-soft">
        🎉 Đã hết tiết cần dạy hôm nay. Nhớ <b>chấm công ra</b> cho buổi đang làm nếu chưa.
      </div>
    );
  }
  const { s, live } = next;
  const start = toMin(s.start_time);
  const end = toMin(s.end_time);
  const wait = start - now;
  const when = live
    ? `Đang diễn ra — còn ${Math.max(0, end - now)} phút`
    : wait >= 60 ? `Bắt đầu sau ${Math.floor(wait / 60)} giờ ${wait % 60 ? `${wait % 60} phút` : ''}`
    : `Bắt đầu sau ${wait} phút`;
  return (
    <div className="rise rise-1 card overflow-hidden flex">
      <div className="w-[96px] shrink-0 bg-brand-grad text-white px-2 py-3.5 flex flex-col items-center justify-center text-center">
        <div className="text-xs font-bold uppercase opacity-85">{s.period ? 'Tiết' : 'Giờ'}</div>
        <div className="text-2xl font-extrabold leading-none">{s.period || fmtTime(s.start_time)}</div>
        <div className="text-xs opacity-90 mt-1.5">{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</div>
      </div>
      <div className="flex-1 min-w-0 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold text-lg truncate">Lớp {s.class_name}</div>
            <div className="text-sm text-ink-muted truncate">
              {s.school_name}{s.room_name ? ` · ${s.room_name}` : ''}{s.subject ? ` · ${s.subject}` : ''}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold
            ${live ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-800'}`}>
            {live ? '● Đang dạy' : 'Sắp tới'}
          </span>
        </div>
        <div className={`mt-2 text-sm font-semibold ${live ? 'text-brand-800' : 'text-ink-soft'}`}>⏱ {when}</div>
        <div className="text-xs text-ink-muted mt-0.5">
          {SESSION_META[s.work_session]?.label} · {s.my_role === 'assistant' ? 'bạn là trợ giảng' : 'bạn là giáo viên'}
          {' '}· điểm danh sĩ số tại lớp ở mục Điểm danh
        </div>
      </div>
    </div>
  );
}

/** Trạng thái chấm công của một buổi. */
function ShiftStatus({ shift }) {
  if (!shift?.check_in_at) {
    return <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-bold">Chưa chấm công vào</span>;
  }
  if (!shift.check_out_at) {
    return (
      <span className="rounded-full bg-brand-100 text-brand-800 px-2.5 py-0.5 text-xs font-bold">
        Đã vào {fmtTime(shift.check_in_at)}{shift.label === 'late' ? ` · trễ ${shift.late_minutes}p` : ''}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-xs font-bold">
      ✓ {fmtTime(shift.check_in_at)} – {fmtTime(shift.check_out_at)}
    </span>
  );
}

/** Một buổi ở một trường: nút chấm công vào/ra + các tiết (gợi ý). */
function ShiftCard({ g, now, nextId }) {
  const meta = SESSION_META[g.session] || SESSION_META.morning;
  const active = g.items.filter(isActive);
  const done = active.filter((s) => s.attendance_done).length;
  const pct = active.length ? Math.round((done / active.length) * 100) : 0;
  const to = `/cham-cong/${g.school_id}?buoi=${g.session}`;
  const nums = active.map((s) => s.period).filter(Boolean);

  return (
    <div className="card overflow-hidden">
      <div className="px-3.5 py-3 flex flex-wrap items-start justify-between gap-2 border-b border-line bg-zinc-50/70">
        <div className="min-w-0">
          <div className="font-extrabold text-lg">
            {meta.icon} {meta.label}
            <span className="text-sm font-semibold text-ink-muted">
              {' '}· {active.length} tiết{nums.length ? ` (tiết ${nums.join(', ')})` : ''}
            </span>
          </div>
          <div className="text-sm text-ink-muted truncate">{g.school_name}</div>
        </div>
        <ShiftStatus shift={g.shift} />
      </div>

      {/* Chấm công MỘT lần cho cả buổi */}
      <div className="px-3.5 pt-3">
        {!g.shift?.check_in_at ? (
          <Link to={to} className="btn-primary w-full !py-2.5">📍 Chấm công vào {meta.label.toLowerCase()}</Link>
        ) : !g.shift.check_out_at ? (
          <Link to={to} className="btn-primary w-full !py-2.5">🏁 Chấm công ra {meta.label.toLowerCase()}</Link>
        ) : (
          <Link to={to} className="btn-line w-full !py-2">Xem chấm công {meta.label.toLowerCase()}</Link>
        )}
        <div className="text-xs text-ink-muted mt-1.5">
          Chấm công một lần vào, một lần ra cho cả buổi — không chấm theo từng tiết.
        </div>
      </div>

      {g.items.length > 0 ? (
        <>
          <ol className="mt-2 divide-y divide-line">
            {g.items.map((s) => {
              const st = tietState(s, now, nextId);
              const muted = st.key === 'cancelled' || st.key === 'skipped';
              const hot = st.key === 'live' || st.key === 'next';
              return (
                <li key={s.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${hot ? 'bg-brand-50/60' : ''}`}>
                  <span className={`h-9 w-12 shrink-0 rounded-lg grid place-items-center text-center leading-none
                    ${st.key === 'done' ? 'bg-emerald-500 text-white'
                      : hot ? 'bg-brand-grad text-white' : muted ? 'bg-zinc-100 text-ink-muted' : 'bg-brand-50 text-brand-800'}`}>
                    <span>
                      <span className="block text-[9.5px] font-bold uppercase opacity-80">{s.period ? 'Tiết' : ''}</span>
                      <span className="block text-lg font-extrabold">{s.period || fmtTime(s.start_time)}</span>
                    </span>
                  </span>
                  <span className={`min-w-0 flex-1 ${muted ? 'opacity-60' : ''}`}>
                    <span className={`block text-sm font-semibold truncate ${muted ? 'line-through' : ''}`}>
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)} · Lớp {s.class_name}
                    </span>
                    <span className="block text-xs text-ink-muted truncate">
                      {muted && s.status_reason ? `Lý do: ${s.status_reason}`
                        : [s.room_name, s.subject, s.my_role === 'assistant' ? 'trợ giảng' : null].filter(Boolean).join(' · ') || ' '}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.text}</span>
                </li>
              );
            })}
          </ol>
          {active.length > 0 && (
            <div className="px-3.5 py-2.5 border-t border-line">
              <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
                <span>Đã điểm danh {done}/{active.length} tiết</span><span>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                <span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3 text-sm text-ink-muted">
          Buổi này không có tiết nào trong lịch dạy (đã chấm công ngoài lịch).
        </div>
      )}
    </div>
  );
}

/** Bảng lịch tuần rút gọn: 7 cột, mỗi ô liệt kê các tiết của ngày đó (chỉ xem). */
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
                <span className={`inline-grid place-items-center h-6 w-6 rounded-full text-xs font-extrabold
                  ${isToday ? 'bg-brand-grad text-white' : 'text-ink-soft'}`}>
                  {d.dayNum}
                </span>
                <span className="block text-xs font-bold uppercase text-ink-muted">{d.label}</span>
              </div>
              <div className="grid gap-1">
                {list.slice(0, 3).map((s) => (
                  <span key={s.id}
                    title={`${s.period ? `Tiết ${s.period} · ` : ''}${fmtTime(s.start_time)} · Lớp ${s.class_name} — ${s.school_name}`}
                    className="block rounded-md bg-white ring-1 ring-inset ring-brand-100 px-1 py-[3px]
                               text-xs font-bold text-brand-900 text-center truncate">
                    {s.period ? `T${s.period}` : fmtTime(s.start_time)}
                    <span className="block font-semibold text-ink-muted truncate">{s.class_name}</span>
                  </span>
                ))}
                {list.length > 3 && (
                  <span className="block text-[9.5px] text-ink-muted text-center">+{list.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 text-xs text-ink-muted bg-canvas/60 border-t border-line">
        Tổng <b>{(items || []).length}</b> tiết trong tuần · T1 = tiết 1
      </div>
    </div>
  );
}

function FieldDashboard({ data }) {
  const [week, setWeek] = useState([]);
  const [weekRange, setWeekRange] = useState(null);
  const [queued, setQueued] = useState(0);
  const [now, setNow] = useState(nowMin);

  // Cập nhật "đang diễn ra / kế tiếp" theo đồng hồ mỗi 30 giây.
  useEffect(() => {
    const id = setInterval(() => setNow(nowMin()), 30_000);
    return () => clearInterval(id);
  }, []);

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
      .then((r) => setWeek((r?.items || []).filter((x) => x.status !== 'cancelled' && x.status !== 'skipped')))
      .catch(() => {});
    pendingCount().then(setQueued).catch(() => {});
  }, []);

  const sessions = [...(data.today_sessions || [])]
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)) || (a.period || 0) - (b.period || 0));
  const groups = groupByShift(sessions, data.today_shifts || []);
  const active = sessions.filter(isActive);
  const next = pickNext(sessions, now);
  const nMorning = active.filter((s) => s.work_session === 'morning').length;
  const nAfternoon = active.length - nMorning;

  const tasks = [];
  const pt = data.pending_tasks || {};
  if (queued > 0) tasks.push({ key: 'sync', label: `${queued} thao tác chờ đồng bộ lên máy chủ`, to: '/cho-dong-bo' });
  if (pt.not_checked_out > 0) tasks.push({ key: 'out', label: `${pt.not_checked_out} buổi chưa chấm công ra`, to: '/cham-cong' });
  if (pt.attendance_missing > 0) tasks.push({ key: 'att', label: `${pt.attendance_missing} tiết đã qua chưa điểm danh`, to: '/diem-danh' });

  const m = data.my_month || {};

  return (
    <>
      <HeroBand tone="gradient">
        <div className="text-sm mt-1 opacity-90">
          {active.length > 0
            ? `Hôm nay bạn có ${active.length} tiết dạy — sáng ${nMorning} · chiều ${nAfternoon}`
              + (next ? ` · tiếp theo: ${tietLabel(next.s)} lớp ${next.s.class_name}` : ' · đã dạy xong 🎉')
            : 'Hôm nay không có tiết dạy — xem trước lịch tuần bên dưới nhé.'}
        </div>
      </HeroBand>

      {/* Việc tồn — luôn nổi lên đầu vì cần hành động */}
      {tasks.length > 0 && (
        <div className="rise rise-1 card border-amber-300 bg-amber-50/80 p-3.5 mt-3.5">
          <div className="eyebrow eyebrow-act mb-2">Việc cần làm ngay</div>
          <div className="grid gap-1.5">
            {tasks.map((t) => (
              <Link key={t.key} to={t.to}
                className="flex items-center justify-between rounded-xl bg-white/80 border border-amber-200 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-white">
                <span>{t.label}</span><span className="text-amber-500">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <>
          <Section kind="act" title="Tiết dạy kế tiếp" />
          <NextTietCard next={next} now={now} />
        </>
      )}

      {groups.length > 0 ? (
        <>
          <Section kind="act" title={`Hôm nay: chấm công & ${active.length} tiết dạy`} to="/lich" toLabel="Thời khoá biểu ›" />
          <div className="rise rise-2 grid gap-3 lg:grid-cols-2 items-start">
            {groups.map((g) => <ShiftCard key={g.key} g={g} now={now} nextId={next?.s.id} />)}
          </div>
        </>
      ) : (
        <div className="rise rise-2 mt-3.5">
          <EmptyState icon="🌤️" title="Hôm nay bạn không có tiết dạy nào"
            hint="Tận hưởng ngày nghỉ, hoặc xem trước học liệu cho tuần tới." />
        </div>
      )}

      {/* Hành động nhanh */}
      <Section kind="ref" title="Hành động nhanh" />
      <QuickActions className="rise rise-3" items={[
        { icon: '📋', label: 'Điểm danh', to: '/diem-danh' },
        { icon: '📍', label: 'Chấm công', to: '/cham-cong' },
        { icon: '📚', label: 'Học liệu', to: '/hoc-lieu' },
        { icon: '🛠️', label: 'Báo hỏng', to: '/thiet-bi' },
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
        <Tile icon="🗓️" num={m.sessions ?? 0} label="Buổi đã chấm công" />
        <Tile icon="✅" chipCls="bg-emerald-50" numCls="text-emerald-600" num={m.ontime ?? 0} label="Đúng giờ" />
        <Tile icon="⏱️" chipCls="bg-amber-50" numCls="text-amber-600" num={m.late ?? 0} label="Trễ" />
        <Tile icon="🚫" chipCls="bg-rose-50" numCls="text-rose-600" num={m.absent ?? 0} label="Vắng" />
      </div>
      <div className="rise rise-6 card mt-2 px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-ink-soft font-medium">⏱️ Tổng giờ làm việc tháng này</span>
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
        <div className="flex items-center justify-between text-sm font-semibold mb-1.5">
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
        <div className="flex gap-4 mt-1.5 text-xs text-ink-muted">
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
        <div className="rise rise-4 card px-4 py-3 text-sm text-ink-muted">
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
                  <span className="block text-lg font-extrabold text-rose-600 leading-none">{fmtTime(p.start_time)}</span>
                  <span className="block text-xs text-ink-muted mt-0.5">{fmtDate(p.session_date)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">Lớp {p.class_name}</span>
                  <span className="block text-xs text-ink-muted truncate">
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
            <div className="rise rise-5 card px-4 py-3 text-sm text-ink-muted">Không có sự cố nào gần đây.</div>
          ) : (
            <div className="rise rise-5 card divide-y divide-line">
              {recentIssues.map((it, i) => (
                <div key={it.id ?? i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    it.priority === 'urgent' ? 'bg-rose-500' : it.priority === 'high' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">
                      {it.device_name || 'Thiết bị'} — {it.description || ''}
                    </span>
                    <span className="block text-xs text-ink-muted truncate">
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

/**
 * TodayScheduleTable — lịch dạy hôm nay toàn hệ thống, dạng bảng gọn.
 * Mỗi dòng kèm 2 chấm trạng thái để Admin/Phòng chuyên môn nhìn phát biết
 * buổi nào đã chấm công / đã điểm danh mà không phải mở từng buổi.
 */
function TodayScheduleTable({ items }) {
  if (!items?.length) {
    return (
      <div className="rise rise-4 card px-4 py-3 text-sm text-ink-muted">
        Hôm nay chưa có buổi dạy nào được xếp lịch.
      </div>
    );
  }
  return (
    <div className="rise rise-4 card overflow-hidden">
      <div className="overflow-x-auto table-cards stagger">
        <table className="w-full min-w-[620px]">
          <thead>
            <tr>
              <th className="th !w-[96px]">Giờ</th>
              <th className="th">Lớp</th>
              <th className="th">Trường</th>
              <th className="th">Giáo viên</th>
              <th className="th !w-[150px]">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td data-label="Giờ" className="td whitespace-nowrap font-bold text-brand-800">
                  {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                </td>
                <td data-label="Lớp" className="td font-semibold">{s.class_name}</td>
                <td data-label="Trường" className="td text-ink-soft">{s.school_name}</td>
                <td data-label="Giáo viên" className="td text-ink-soft">
                  {s.teacher_name || '—'}
                  {s.assistant_name && (
                    <span className="block text-xs text-ink-muted">TG: {s.assistant_name}</span>
                  )}
                </td>
                <td data-label="Trạng thái" className="td">
                  <span className="flex flex-col gap-0.5 text-xs">
                    <span className={s.has_timesheet ? 'text-emerald-600 font-semibold' : 'text-ink-muted'}>
                      {s.has_timesheet ? '✓' : '○'} Chấm công
                    </span>
                    <span className={s.has_attendance ? 'text-emerald-600 font-semibold' : 'text-ink-muted'}>
                      {s.has_attendance ? '✓' : '○'} Điểm danh
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 text-xs text-ink-muted bg-canvas/60 border-t border-line">
        Tổng <b>{items.length}</b> buổi hôm nay
      </div>
    </div>
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

      <Section kind="watch" title="Lịch dạy hôm nay" to="/lich" toLabel="Xem lịch đầy đủ ›" />
      <TodayScheduleTable items={data.today_schedule} />

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
                <span className="flex-1 text-sm font-semibold">{LABEL.role[role]}</span>
                <span className="tile-num !text-xl text-ink">{fmtNumber(staff[role] ?? 0)}</span>
              </div>
            ))}
            <Link to="/tai-khoan" className="queue-row !py-3 text-brand-700 font-bold text-sm justify-center">
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
            <div className="rise rise-5 card px-4 py-3 text-sm text-ink-muted">Chưa có thao tác nào được ghi.</div>
          ) : (
            <div className="rise rise-5 card divide-y divide-line">
              {auditRows.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <span className="text-base mt-px">{AUDIT_ICON[a.action] || '•'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-ink-soft">
                      <b className="text-ink">{a.actor_name || 'Hệ thống'}</b> — {a.summary || `${a.action} ${a.entity}`}
                    </span>
                    <span className="block text-xs text-ink-muted mt-0.5">{fmtAgo(a.created_at)}</span>
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
                <span className="h-8 w-8 rounded-full bg-brand-grad-soft text-white grid place-items-center text-sm font-bold shrink-0">
                  {(u.full_name || '?').trim().split(/\s+/).pop()[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{u.full_name}</span>
                  <span className="block text-xs text-ink-muted">
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
  useEffect(() => {
    if (!auth.isFieldStaff) return undefined;
    const tick = () => { if (!document.hidden) load(); };
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [auth.isFieldStaff, load]);

  if (error && !data) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <PageLoading />;

  if (auth.isAdmin) return <AdminDashboard data={data} />;
  if (auth.isFieldStaff) return <FieldDashboard data={data} />;
  return <ManagerDashboard data={data} />;
}
