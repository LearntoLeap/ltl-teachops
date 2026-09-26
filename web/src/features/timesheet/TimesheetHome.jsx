/**
 * TimesheetHome.jsx — Màn hình Chấm công.
 *
 * - Giáo viên / Trợ giảng: buổi hôm nay (nút Check-in / Check-out) + lịch sử của tôi.
 * - Quản trị / Phòng chuyên môn: 3 tab — Chờ duyệt / Tất cả / Đối chiếu (+ xuất Excel).
 *   Query `?duyet=1` mở thẳng tab Chờ duyệt (dùng cho liên kết từ Dashboard/thông báo).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { sessionOfSchedule } from '../../lib/periods.js';
import {
  LABEL, fmtDate, fmtDateLong, fmtDistance, fmtNumber, fmtRange, fmtTime,
  initials, monthRange, today,
} from '../../lib/format.js';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading, Pager, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

/* ------------------------- Trích trường dữ liệu an toàn ------------------------- */
const asItems = (res) => (Array.isArray(res) ? res : res?.items || []);
const clsName = (x) => x?.class_name || x?.class?.name || x?.schedule?.class_name || 'Lớp';

const SESSION_VN = { morning: 'Buổi sáng', afternoon: 'Buổi chiều' };
// Buổi của một tiết: tiết 1–5 sáng, 6+ chiều (xem lib/periods.js).
const sessionOf = sessionOfSchedule;
/** Đang là buổi sáng hay chiều theo giờ Việt Nam (mốc 12:00). */
const sessionNow = () => (new Date(Date.now() + 7 * 3600_000).getUTCHours() < 12 ? 'morning' : 'afternoon');

/**
 * Gom buổi dạy hôm nay theo (trường × buổi) — đơn vị chấm công.
 * Mỗi nhóm là MỘT lần chấm công vào và MỘT lần ra, kèm danh sách tiết để nhắc giờ.
 */
function groupShifts(items, shifts, schools, session) {
  const map = new Map();

  // Mọi trường trong phạm vi đều phải chấm công được, kể cả hôm nay không có
  // tiết nào — giáo viên vẫn có thể tới trường làm việc.
  for (const sc of schools || []) {
    const key = `${sc.id}|${session}`;
    map.set(key, { key, school_id: sc.id, school_name: sc.name, session, periods: [] });
  }

  for (const s of items) {
    if (s.status === 'cancelled' || s.status === 'skipped') continue;
    const session = sessionOf(s);
    const key = `${s.school_id}|${session}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        school_id: s.school_id,
        school_name: s.school_name || s.school?.name || 'Trường',
        session,
        periods: [],
      });
    }
    map.get(key).periods.push(s);
  }
  for (const g of map.values()) {
    g.periods.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    g.ts = (shifts || []).find((t) => t.school_id === g.school_id && t.work_session === g.session) || null;
  }
  // Trường có tiết hoặc đã chấm công thì lên trước; trường "trống" vẫn giữ lại
  // để giáo viên chủ động chấm công.
  return [...map.values()].sort((a, b) =>
    (b.periods.length > 0 || !!b.ts) - (a.periods.length > 0 || !!a.ts)
    || (a.session === b.session ? 0 : a.session === 'morning' ? -1 : 1)
    || a.school_name.localeCompare(b.school_name));
}
const schName = (x) => x?.school_name || x?.school?.name || x?.schedule?.school_name || '';
const roomName = (x) => x?.room_name || x?.room?.name || '';
const personName = (x) => x?.user_name || x?.user?.full_name || x?.full_name || '';
const rowDate = (t) => t?.work_date || t?.session_date || t?.date || t?.schedule?.date || t?.check_in_at || '';
/** Nhãn buổi của một dòng chấm công; dữ liệu cũ thì suy từ giờ check-in. */
const shiftName = (t) => SESSION_VN[t?.work_session]
  || (String(fmtTime(t?.check_in_at) || '').slice(0, 5) < '12:00' ? 'Buổi sáng' : 'Buổi chiều');
const rowRange = (t) => fmtRange(
  t?.start_time || t?.schedule?.start_time,
  t?.end_time || t?.schedule?.end_time,
);
/** Gom mọi id ảnh minh chứng có thể có trên một bản ghi chấm công. */
function photoIds(t) {
  const ids = [];
  if (Array.isArray(t?.photos)) t.photos.forEach((p) => ids.push(p?.id || p));
  [t?.check_in_photo_id, t?.check_out_photo_id, t?.damage_photo_id, t?.photo_id]
    .forEach((id) => { if (id) ids.push(id); });
  return [...new Set(ids.filter(Boolean))];
}

/** Tổng hợp nhanh từ danh sách bản ghi (dùng khi server không trả summary). */
function summarize(items) {
  const s = { total: items.length, ontime: 0, late: 0, absent: 0, lateMin: 0 };
  for (const t of items) {
    if (t.label === 'ontime') s.ontime += 1;
    else if (t.label === 'late') s.late += 1;
    else if (t.label === 'absent') s.absent += 1;
    s.lateMin += Number(t.late_minutes) || 0;
  }
  return s;
}

/* ------------------------------ Mảnh giao diện nhỏ ----------------------------- */
function AttendBadge({ label }) {
  if (!label) return <span className="text-xs text-ink-muted">—</span>;
  return <Badge tone={label}>{LABEL.attend[label] || label}</Badge>;
}

function ApprovalBadge({ status }) {
  if (!status || status === 'approved') return null;
  return <Badge tone={status}>{LABEL.approval[status] || status}</Badge>;
}

function StatCell({ label, value, className = '' }) {
  return (
    <div className="card px-2 py-2.5 text-center">
      <div className={`text-xl font-extrabold leading-tight ${className}`}>{value}</div>
      <div className="text-xs text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

function RangeFilter({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date" className="input !w-auto !py-2 !px-2.5 text-sm" value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Từ ngày" />
      <span className="text-ink-muted">–</span>
      <input
        type="date" className="input !w-auto !py-2 !px-2.5 text-sm" value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Đến ngày" />
    </div>
  );
}

/** Bảng chấm công dùng chung cho "Lịch sử của tôi" và tab "Tất cả". */
function TimesheetTable({ items, showUser = false }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto table-cards stagger">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <th className="th">Ngày</th>
              {showUser && <th className="th">Người dạy</th>}
              <th className="th">Buổi · Trường</th>
              <th className="th">Vào – Ra</th>
              <th className="th">Trạng thái</th>
              <th className="th text-right">Trễ</th>
              <th className="th text-right">Tiết</th>
              <th className="th">Duyệt</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t, i) => (
              <tr key={t.id || i}>
                <td data-label="Ngày" className="td whitespace-nowrap">{fmtDate(rowDate(t))}</td>
                {showUser && <td data-label="Người dạy" className="td whitespace-nowrap">{personName(t) || '—'}</td>}
                <td data-label="Buổi · Trường" className="td">
                  <div className="font-medium">{shiftName(t)}</div>
                  <div className="text-xs text-ink-muted">{schName(t)}</div>
                </td>
                <td data-label="Vào – Ra" className="td whitespace-nowrap">
                  {fmtTime(t.check_in_at) || '—'} – {fmtTime(t.check_out_at) || '—'}
                </td>
                <td data-label="Trạng thái" className="td"><AttendBadge label={t.label} /></td>
                <td data-label="Trễ" className="td text-right whitespace-nowrap">
                  {Number(t.late_minutes) > 0 ? `${fmtNumber(t.late_minutes)} ph` : ''}
                </td>
                <td data-label="Tiết" className="td text-right whitespace-nowrap text-ink-muted">
                  {t.planned_periods ?? '—'}
                </td>
                <td data-label="Duyệt" className="td"><ApprovalBadge status={t.approval_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ======================= GIÁO VIÊN / TRỢ GIẢNG ======================= */

function TodaySection() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [shifts, setShifts] = useState([]);   // chấm công của tôi hôm nay, theo buổi
  const [schools, setSchools] = useState([]); // trường trong phạm vi
  // Buổi đang làm việc theo đồng hồ — quyết định thẻ nào hiện ra trước.
  const nowSession = sessionNow();
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
      const [today, mine, sc] = await Promise.all([
        api.get('/api/schedules/today'),
        // Chấm công của chính mình hôm nay — khớp theo (trường, buổi), không theo tiết.
        api.get('/api/timesheets', { from: day, to: day, limit: 50 }).catch(() => ({ items: [] })),
        // Trường trong phạm vi — để chấm công được cả khi hôm nay không có tiết.
        api.get('/api/schools', { limit: 50 }).catch(() => ({ items: [] })),
      ]);
      setItems(asItems(today));
      setShifts(asItems(mine));
      setSchools(asItems(sc));
    }
    catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-lg font-bold text-ink">Hôm nay</h2>
        <span className="text-xs text-ink-muted">{fmtDateLong(today())}</span>
      </div>

      {err && <ErrorBox error={err} onRetry={load} />}
      {!err && items === null && <PageLoading label="Đang tải buổi dạy hôm nay…" />}



      {!err && items !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          {groupShifts(items, shifts, schools, nowSession).map((g) => {
            const ts = g.ts;
            const done = !!(ts?.check_in_at && ts?.check_out_at);
            const inOnly = !!(ts?.check_in_at && !ts?.check_out_at);
            const go = () => navigate(`/cham-cong/${g.school_id}?buoi=${g.session}`);
            return (
              <div key={g.key} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xl font-extrabold text-brand-800">
                      {SESSION_VN[g.session]}
                    </div>
                    <div className="font-semibold mt-0.5 truncate">{g.school_name}</div>
                    <div className="text-sm text-ink-muted">
                      {g.periods.length > 0
                        ? <>Gợi ý: {g.periods.length} tiết · có mặt trước <b>{fmtTime(g.periods[0]?.start_time)}</b></>
                        : 'Hôm nay không có tiết nào trong lịch'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <AttendBadge label={ts?.label} />
                    <ApprovalBadge status={ts?.approval_status} />
                  </div>
                </div>

                {/* Lịch dạy chỉ để GỢI Ý — chấm công không gắn với tiết nào. */}
                {g.periods.length > 0 && (
                <div className="mt-2.5 rounded-xl bg-canvas border border-line px-3 py-2 grid gap-1">
                  {g.periods.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-brand-800 w-[52px] shrink-0">
                        {p.period ? `Tiết ${p.period}` : fmtTime(p.start_time)}
                      </span>
                      <span className="truncate">{clsName(p)}</span>
                      {(p.attendance_done ?? p.has_attendance) ? (
                        <span className="text-emerald-700 font-semibold ml-auto shrink-0">
                          ✓ {p.present_count != null ? `${p.present_count}/${p.attendance_roster_size ?? '—'} HS` : 'đã điểm danh'}
                        </span>
                      ) : (
                        <span className="text-ink-muted ml-auto shrink-0">chưa điểm danh</span>
                      )}
                    </div>
                  ))}
                </div>
                )}

                {(ts?.check_in_at || ts?.check_out_at) && (
                  <div className="text-sm text-ink-soft mt-2">
                    Vào <b>{fmtTime(ts?.check_in_at) || '—'}</b> · Ra <b>{fmtTime(ts?.check_out_at) || '—'}</b>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className={ts?.check_in_at ? 'btn-line !py-3' : 'btn-primary !py-3 text-lg'}
                    disabled={!!ts?.check_in_at}
                    onClick={go}>
                    {ts?.check_in_at ? `✅ Vào ${fmtTime(ts.check_in_at)}` : '📍 Chấm công vào'}
                  </button>
                  <button
                    className={inOnly ? 'btn-primary !py-3 text-lg' : 'btn-line !py-3'}
                    disabled={!ts?.check_in_at || done}
                    onClick={go}>
                    {done ? `✅ Ra ${fmtTime(ts.check_out_at)}` : '🏁 Chấm công ra'}
                  </button>
                </div>
                {done && (
                  <button className="btn-line w-full !py-2 mt-2 text-sm" onClick={go}>
                    Xem chi tiết chấm công
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MyHistorySection() {
  const [range, setRange] = useState(() => monthRange());
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const limit = 200;

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await api.get('/api/timesheets', { from: range.from, to: range.to, page, limit }));
    } catch (e) { setErr(e); }
  }, [range.from, range.to, page]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => asItems(data), [data]);
  const sum = useMemo(() => summarize(items), [items]);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <h2 className="text-lg font-bold text-ink">Lịch sử của tôi</h2>
        <RangeFilter value={range} onChange={(v) => { setRange(v); setPage(1); }} />
      </div>

      {err && <ErrorBox error={err} onRetry={load} />}
      {!err && data === null && <PageLoading label="Đang tải lịch sử chấm công…" />}

      {!err && data !== null && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
            <StatCell label="Tổng buổi" value={fmtNumber(sum.total)} className="text-brand-800" />
            <StatCell label="Đúng giờ" value={fmtNumber(sum.ontime)} className="text-emerald-600" />
            <StatCell label="Trễ" value={fmtNumber(sum.late)} className="text-amber-600" />
            <StatCell label="Vắng" value={fmtNumber(sum.absent)} className="text-rose-600" />
            <StatCell label="Phút trễ" value={fmtNumber(sum.lateMin)} className="text-amber-700" />
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon="📍"
              title="Chưa có bản chấm công nào trong khoảng này"
              hint="Check-in ở mục Hôm nay phía trên khi bạn đến trường dạy." />
          ) : (
            <>
              <TimesheetTable items={items} />
              <Pager page={page} limit={limit} total={data?.total} onPage={setPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function FieldView() {
  return (
    <div className="grid gap-6">
      <TodaySection />
      <MyHistorySection />
    </div>
  );
}

/* ======================= QUẢN TRỊ / PHÒNG CHUYÊN MÔN ======================= */

function PendingCard({ t, busy, canApprove, onApprove, onReject }) {
  const ids = photoIds(t);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="h-9 w-9 rounded-full bg-brand-grad-soft text-white grid place-items-center font-bold shrink-0">
          {initials(personName(t))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{personName(t) || 'Không rõ người dạy'}</div>
          <div className="text-xs text-ink-muted">
            {fmtDate(rowDate(t))}{rowRange(t) ? ` · ${rowRange(t)}` : ''}
          </div>
        </div>
        <AttendBadge label={t.label} />
      </div>

      <div className="text-sm text-ink-soft">
        <div className="font-medium text-ink">{clsName(t)} <span className="text-ink-muted font-normal">· {schName(t)}</span></div>
        <div className="mt-1">
          Vào <b>{fmtTime(t.check_in_at) || '—'}</b> · Ra <b>{fmtTime(t.check_out_at) || '—'}</b>
          {Number(t.late_minutes) > 0 && (
            <span className="text-amber-700 font-semibold"> · Trễ {fmtNumber(t.late_minutes)} phút</span>
          )}
        </div>
        <div className="mt-1">
          📍 Cách trường:{' '}
          <span className="font-bold text-rose-600">{fmtDistance(t.check_in_distance_m)}</span>
          {t.gps_flagged && <Badge tone="rejected" className="ml-2">Lệch vị trí</Badge>}
        </div>
        {t.note && <div className="mt-1.5 rounded-lg bg-canvas px-2.5 py-2 text-sm">📝 {t.note}</div>}
      </div>

      {ids.length > 0 && (
        <div className="flex gap-2 mt-2.5">
          {ids.map((id) => (
            <a key={id} href={fileUrl(id)} target="_blank" rel="noreferrer" title="Mở ảnh đầy đủ">
              <img
                src={fileUrl(id, { thumb: true })} alt="Ảnh minh chứng"
                className="h-16 w-16 rounded-lg object-cover border border-line" />
            </a>
          ))}
        </div>
      )}

      {canApprove && (
        <div className="flex gap-2 mt-3">
          <button className="btn-line flex-1" disabled={busy} onClick={onReject}>Từ chối</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={onApprove}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Duyệt'}
          </button>
        </div>
      )}
    </div>
  );
}

function PendingTab() {
  const auth = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setItems(asItems(await api.get('/api/timesheets', { approval_status: 'pending', limit: 100 })));
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (t) => {
    setBusyId(t.id);
    try {
      await api.post(`/api/timesheets/${t.id}/approve`, { decision: 'approved' });
      setItems((xs) => xs.filter((x) => x.id !== t.id));
      toast.ok('Đã duyệt chấm công');
    } catch (e) { toast.fromError(e); }
    finally { setBusyId(null); }
  };

  const doReject = async () => {
    if (!reason.trim() || rejectBusy) return;
    setRejectBusy(true);
    try {
      await api.post(`/api/timesheets/${reject.id}/approve`, { decision: 'rejected', reason: reason.trim() });
      setItems((xs) => xs.filter((x) => x.id !== reject.id));
      toast.ok('Đã từ chối bản chấm công');
      setReject(null);
      setReason('');
    } catch (e) { toast.fromError(e); }
    finally { setRejectBusy(false); }
  };

  if (err) return <ErrorBox error={err} onRetry={load} />;
  if (items === null) return <PageLoading label="Đang tải danh sách chờ duyệt…" />;

  return (
    <>
      {items.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Không còn bản chấm công nào chờ duyệt"
          hint="Bản check-in lệch vị trí hoặc bất thường sẽ tự xuất hiện ở đây." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((t) => (
            <PendingCard
              key={t.id}
              t={t}
              busy={busyId === t.id}
              canApprove={auth.can('timesheet.approve')}
              onApprove={() => approve(t)}
              onReject={() => { setReject(t); setReason(''); }} />
          ))}
        </div>
      )}

      <Sheet
        open={!!reject}
        onClose={rejectBusy ? undefined : () => setReject(null)}
        title="Từ chối chấm công">
        {reject && (
          <>
            <div className="text-sm text-ink-soft mb-3">
              Từ chối bản chấm công của <b>{personName(reject) || 'người dạy'}</b> — {clsName(reject)} ({fmtDate(rowDate(reject))}).
              Người dạy sẽ nhận được thông báo kèm lý do.
            </div>
            <Field label="Lý do từ chối" required>
              <textarea
                className="input min-h-[84px]" autoFocus
                placeholder="Ví dụ: vị trí check-in cách trường quá xa, ảnh minh chứng không rõ…"
                value={reason}
                onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2.5 justify-end">
              <button className="btn-line" onClick={() => setReject(null)} disabled={rejectBusy}>Huỷ</button>
              <button className="btn-danger" onClick={doReject} disabled={rejectBusy || !reason.trim()}>
                {rejectBusy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Từ chối'}
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

function AllTab() {
  const [range, setRange] = useState(() => monthRange());
  const [schoolId, setSchoolId] = useState('');
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [schools, setSchools] = useState([]);
  const [users, setUsers] = useState([]);
  const limit = 50;

  useEffect(() => {
    api.get('/api/schools', { limit: 200 }).then((r) => setSchools(asItems(r))).catch(() => {});
    api.get('/api/users', { limit: 200 }).then((r) => setUsers(asItems(r))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await api.get('/api/timesheets', {
        from: range.from, to: range.to,
        school_id: schoolId, user_id: userId, label,
        page, limit,
      }));
    } catch (e) { setErr(e); }
  }, [range.from, range.to, schoolId, userId, label, page]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => asItems(data), [data]);
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <RangeFilter value={range} onChange={reset(setRange)} />
        <select className="input !w-auto !py-2 text-sm" value={schoolId}
          onChange={(e) => reset(setSchoolId)(e.target.value)} aria-label="Lọc theo trường">
          <option value="">Tất cả trường</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input !w-auto !py-2 text-sm" value={userId}
          onChange={(e) => reset(setUserId)(e.target.value)} aria-label="Lọc theo người dạy">
          <option value="">Tất cả mọi người</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select className="input !w-auto !py-2 text-sm" value={label}
          onChange={(e) => reset(setLabel)(e.target.value)} aria-label="Lọc theo nhãn">
          <option value="">Mọi trạng thái</option>
          {Object.entries(LABEL.attend).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <ErrorBox error={err} onRetry={load} />}
      {!err && data === null && <PageLoading label="Đang tải bảng chấm công…" />}

      {!err && data !== null && (
        items.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="Không có bản chấm công nào khớp bộ lọc"
            hint="Thử nới khoảng ngày hoặc bỏ bớt bộ lọc trường / người / trạng thái." />
        ) : (
          <>
            <TimesheetTable items={items} showUser />
            <Pager page={page} limit={limit} total={data?.total} onPage={setPage} />
          </>
        )
      )}
    </>
  );
}

function ReconcileTab() {
  const auth = useAuth();
  const toast = useToast();
  const [range, setRange] = useState(() => monthRange());
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState([]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.get('/api/schools', { limit: 200 }).then((r) => setSchools(asItems(r))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await api.get('/api/timesheets/reconcile', {
        from: range.from, to: range.to, school_id: schoolId,
      }));
    } catch (e) { setErr(e); }
  }, [range.from, range.to, schoolId]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (Array.isArray(data)) return data;
    return data?.items || data?.rows || data?.details || [];
  }, [data]);
  const summary = useMemo(() => {
    const fb = summarize(rows);
    const s = data?.summary || {};
    const pick = (keys, fallback) => {
      for (const k of keys) if (s[k] !== undefined && s[k] !== null) return s[k];
      return fallback;
    };
    return {
      total: pick(['total', 'total_sessions', 'sessions'], fb.total),
      ontime: pick(['ontime', 'on_time'], fb.ontime),
      late: pick(['late'], fb.late),
      absent: pick(['absent', 'missing'], fb.absent),
      lateMin: pick(['late_minutes', 'total_late_minutes'], fb.lateMin),
    };
  }, [data, rows]);

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await api.download(
        '/api/reports/timesheets.xlsx',
        { from: range.from, to: range.to, school_id: schoolId },
        'cham-cong.xlsx',
      );
      toast.ok('Đã tải tệp Excel về máy');
    } catch (e) { toast.fromError(e); }
    finally { setExporting(false); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <RangeFilter value={range} onChange={setRange} />
        <select className="input !w-auto !py-2 text-sm" value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)} aria-label="Lọc theo trường">
          <option value="">Tất cả trường</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {auth.canAny('export.all', 'export.scope') && (
          <button className="btn-line !py-2 ml-auto" onClick={doExport} disabled={exporting}>
            {exporting ? <Spinner className="h-4 w-4" /> : '⬇️ Xuất Excel'}
          </button>
        )}
      </div>

      {err && <ErrorBox error={err} onRetry={load} />}
      {!err && data === null && <PageLoading label="Đang đối chiếu kế hoạch và thực tế…" />}

      {!err && data !== null && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
            <StatCell label="Tổng buổi" value={fmtNumber(summary.total)} className="text-brand-800" />
            <StatCell label="Đúng giờ" value={fmtNumber(summary.ontime)} className="text-emerald-600" />
            <StatCell label="Trễ" value={fmtNumber(summary.late)} className="text-amber-600" />
            <StatCell label="Vắng" value={fmtNumber(summary.absent)} className="text-rose-600" />
            <StatCell label="Tổng phút trễ" value={fmtNumber(summary.lateMin)} className="text-amber-700" />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon="📊"
              title="Không có buổi dạy nào trong khoảng này"
              hint="Chọn khoảng ngày khác hoặc bỏ lọc trường để xem toàn bộ." />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto table-cards stagger">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="th">Ngày</th>
                      <th className="th">Buổi</th>
                      <th className="th">Trường</th>
                      <th className="th">Người phụ trách</th>
                      <th className="th">Vào – Ra</th>
                      <th className="th">Trạng thái</th>
                      <th className="th text-right">Trễ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id || `${r.schedule_id || i}-${r.user_id || ''}`}>
                        <td data-label="Ngày" className="td whitespace-nowrap">{fmtDate(rowDate(r))}</td>
                        <td data-label="Buổi" className="td whitespace-nowrap">{shiftName(r)}</td>
                        <td data-label="Trường" className="td">
                          <div className="font-medium">{schName(r)}</div>
                          <div className="text-xs text-ink-muted">
                            {r.planned_periods ? `${r.planned_periods} tiết theo lịch` : 'Không có tiết trong lịch'}
                          </div>
                        </td>
                        <td data-label="Người phụ trách" className="td whitespace-nowrap">{personName(r) || '—'}</td>
                        <td data-label="Vào – Ra" className="td whitespace-nowrap">
                          {fmtTime(r.check_in_at) || '—'} – {fmtTime(r.check_out_at) || '—'}
                        </td>
                        <td data-label="Trạng thái" className="td">
                          {r.label
                            ? <AttendBadge label={r.label} />
                            : <Badge tone="absent">Chưa chấm công</Badge>}
                        </td>
                        <td data-label="Trễ" className="td text-right whitespace-nowrap">
                          {Number(r.late_minutes) > 0 ? `${fmtNumber(r.late_minutes)} ph` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ManagerView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (searchParams.get('duyet') === '1' ? 'pending' : 'all'));

  const switchTab = (v) => {
    setTab(v);
    setSearchParams(v === 'pending' ? { duyet: '1' } : {}, { replace: true });
  };

  return (
    <>
      <Segmented
        className="mb-4"
        value={tab}
        onChange={switchTab}
        options={[
          { value: 'pending', label: 'Chờ duyệt' },
          { value: 'all', label: 'Tất cả' },
          { value: 'reconcile', label: 'Đối chiếu' },
        ]} />
      {tab === 'pending' && <PendingTab />}
      {tab === 'all' && <AllTab />}
      {tab === 'reconcile' && <ReconcileTab />}
    </>
  );
}

/* ================================ Màn hình chính ================================ */

export default function TimesheetHome() {
  const auth = useAuth();
  return (
    <>
      <PageHeader
        title="Chấm công"
        sub={auth.isFieldStaff
          ? 'Đến trường chấm công vào, ra về chấm công ra — mỗi ca sáng/chiều một lần.'
          : 'Duyệt chấm công lệch vị trí và đối chiếu kế hoạch – thực tế.'} />
      {auth.isFieldStaff ? <FieldView /> : <ManagerView />}
    </>
  );
}
