/**
 * AttendanceHome.jsx — Màn hình Điểm danh (/diem-danh).
 *
 * - Giáo viên / Trợ giảng: tab "Hôm nay" (buổi dạy của tôi — bấm điểm danh ngay)
 *   và tab "Lịch sử" (bản ghi điểm danh trong tháng).
 * - Quản trị / Phòng chuyên môn: tab "Chưa điểm danh" (buổi quá giờ chưa điểm danh,
 *   kèm nút Nhắc) và tab "Lịch sử" có lọc trường/lớp + xuất Excel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDate, fmtDateLong, fmtRange, monthRange, today } from '../../lib/format.js';
import {
  Badge, EmptyState, ErrorBox, PageHeader, PageLoading, Pager, Segmented, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const LIMIT = 50;

/** Chuẩn hoá phản hồi danh sách: mảng trần hoặc { items: [] }. */
const asItems = (res) => (Array.isArray(res) ? res : res?.items || []);

/** Id ảnh đầu tiên của bản ghi điểm danh — chịu được nhiều dạng dữ liệu trả về. */
function firstPhotoId(row) {
  const p = row?.photos?.[0] ?? row?.photo_ids?.[0] ?? row?.files?.[0];
  if (!p) return null;
  return typeof p === 'object' ? p.id || p.file_id || null : p;
}

/* ============================== Tab: Hôm nay =============================== */
/* Dành cho giáo viên / trợ giảng: các buổi dạy hôm nay của chính mình. */

function TodayTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(asItems(await api.get('/api/schedules/today')));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!items) return <PageLoading />;
  if (!items.length) {
    return (
      <EmptyState
        icon="🗓️"
        title="Hôm nay bạn không có buổi dạy"
        hint="Khi được phân công lịch dạy, buổi học sẽ hiện tại đây để bạn điểm danh."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="text-[13px] text-ink-muted">{fmtDateLong(today())}</div>
      {items.map((s) => {
        const done = !!(s.attendance_done ?? s.has_attendance);
        return (
          <div key={s.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-[15.5px] truncate">{s.class_name || s.class?.name || 'Lớp học'}</div>
                <div className="text-[13px] text-ink-muted truncate">{s.school_name || s.school?.name}</div>
                <div className="text-[13px] text-ink-soft mt-1">
                  🕒 {fmtRange(s.start_time, s.end_time)}
                  {(s.room_name || s.room?.name) ? <span> · 🚪 {s.room_name || s.room?.name}</span> : null}
                </div>
              </div>
              {done && <Badge tone="approved">Đã điểm danh</Badge>}
            </div>
            <div className="mt-3">
              {done ? (
                <Link to={`/diem-danh/${s.id}`} className="btn-line w-full">Xem lại bản ghi</Link>
              ) : (
                <Link to={`/diem-danh/${s.id}`} className="btn-primary w-full">📋 Điểm danh ngay</Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================== Tab: Chưa điểm danh =========================== */
/* Dành cho quản trị / phòng chuyên môn: buổi đã qua giờ mà chưa có điểm danh. */

function PendingTab() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [remindingId, setRemindingId] = useState(null);
  const [reminded, setReminded] = useState(() => new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(asItems(await api.get('/api/attendance/pending')));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remind = async (scheduleId) => {
    setRemindingId(scheduleId);
    try {
      await api.post(`/api/attendance/${scheduleId}/remind`);
      toast.ok('Đã gửi nhắc điểm danh cho người phụ trách.');
      setReminded((prev) => new Set(prev).add(scheduleId));
    } catch (e) {
      toast.fromError(e);
    } finally {
      setRemindingId(null);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!items) return <PageLoading />;
  if (!items.length) {
    return (
      <EmptyState
        icon="✅"
        title="Không có buổi nào chờ điểm danh"
        hint="Mọi buổi dạy đã qua giờ đều được điểm danh đầy đủ."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((p) => {
        const sid = p.schedule_id || p.id;
        const staff = p.teacher_name || p.assignee_name
          || (p.assignments || p.staff || []).map((a) => a.full_name || a.name).filter(Boolean).join(', ');
        return (
          <div key={sid} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-[15px] truncate">{p.class_name || p.class?.name || 'Lớp học'}</div>
                <div className="text-[13px] text-ink-muted truncate">{p.school_name || p.school?.name}</div>
              </div>
              <Badge tone="pending">Chưa điểm danh</Badge>
            </div>
            <div className="text-[13px] text-ink-soft mt-2">
              🗓️ {fmtDate(p.session_date || p.date)} · 🕒 {fmtRange(p.start_time, p.end_time)}
            </div>
            {staff && (
              <div className="text-[13px] text-ink-soft mt-1 truncate">👤 {staff}</div>
            )}
            <button
              className="btn-line w-full mt-3"
              disabled={remindingId === sid || reminded.has(sid)}
              onClick={() => remind(sid)}>
              {remindingId === sid ? <Spinner className="h-4 w-4" />
                : reminded.has(sid) ? '✓ Đã nhắc'
                : '🔔 Nhắc điểm danh'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* =============================== Tab: Lịch sử =============================== */

function HistoryTab({ managerView }) {
  const auth = useAuth();
  const toast = useToast();
  const canExport = managerView && auth.canAny('export.scope', 'export.all');

  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // '2026-09' → ngày đầu & cuối tháng (dùng ngày 02 để tránh lệch múi giờ).
  const { from, to } = useMemo(() => monthRange(`${month}-02T00:00:00`), [month]);

  useEffect(() => {
    if (!managerView) return;
    api.get('/api/schools').then((r) => setSchools(asItems(r))).catch(() => setSchools([]));
  }, [managerView]);

  useEffect(() => {
    if (!managerView || !schoolId) { setClasses([]); return; }
    api.get('/api/classes', { school_id: schoolId }).then((r) => setClasses(asItems(r))).catch(() => setClasses([]));
  }, [managerView, schoolId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/attendance', {
        from, to, school_id: schoolId, class_id: classId, page, limit: LIMIT,
      });
      setData({ items: asItems(res), total: res?.total ?? asItems(res).length });
    } catch (e) {
      setError(e);
    }
  }, [from, to, schoolId, classId, page]);

  useEffect(() => { load(); }, [load]);

  const doExport = async () => {
    setExporting(true);
    try {
      await api.download('/api/reports/attendance.xlsx', { from, to, school_id: schoolId }, 'diem-danh.xlsx');
      toast.ok('Đã tải tệp Excel về máy.');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="month"
          className="input !w-auto"
          value={month}
          onChange={(e) => { setMonth(e.target.value || today().slice(0, 7)); setPage(1); }}
          aria-label="Chọn tháng"
        />
        {managerView && (
          <select
            className="input !w-auto"
            value={schoolId}
            onChange={(e) => { setSchoolId(e.target.value); setClassId(''); setPage(1); }}
            aria-label="Lọc theo trường">
            <option value="">Tất cả trường</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {managerView && schoolId && (
          <select
            className="input !w-auto"
            value={classId}
            onChange={(e) => { setClassId(e.target.value); setPage(1); }}
            aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {canExport && (
          <button className="btn-line ml-auto" onClick={doExport} disabled={exporting}>
            {exporting ? <Spinner className="h-4 w-4" /> : '⬇️ Xuất Excel'}
          </button>
        )}
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !data ? (
        <PageLoading />
      ) : !data.items.length ? (
        <EmptyState
          icon="📋"
          title="Chưa có bản ghi điểm danh"
          hint={managerView
            ? 'Thử đổi tháng hoặc bỏ bớt bộ lọc trường/lớp.'
            : 'Bản ghi điểm danh của bạn trong tháng sẽ hiện tại đây.'}
        />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Ngày</th>
                    <th className="th">Lớp</th>
                    <th className="th">Sĩ số</th>
                    <th className="th">Người điểm danh</th>
                    <th className="th">Ảnh</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => {
                    const pid = firstPhotoId(r);
                    const present = Number(r.present_count);
                    const roster = Number(r.roster_size);
                    const short = Number.isFinite(present) && Number.isFinite(roster) && present < roster;
                    return (
                      <tr key={r.id}>
                        <td className="td whitespace-nowrap">{fmtDate(r.date || r.created_at)}</td>
                        <td className="td">
                          <div className="font-medium">{r.class_name || r.class?.name || '—'}</div>
                          <div className="text-[12px] text-ink-muted">{r.school_name || r.school?.name}</div>
                        </td>
                        <td className="td whitespace-nowrap">
                          <span className={short ? 'text-amber-700 font-bold' : 'font-semibold'}>
                            {r.present_count ?? '—'}/{r.roster_size ?? '—'}
                          </span>
                        </td>
                        <td className="td">{r.marked_by_name || r.marked_by?.full_name || '—'}</td>
                        <td className="td">
                          {pid ? (
                            <a href={fileUrl(pid)} target="_blank" rel="noreferrer" title="Mở ảnh đầy đủ">
                              <img
                                src={fileUrl(pid, { thumb: true })}
                                alt="Ảnh điểm danh"
                                className="h-10 w-10 rounded-lg object-cover border border-line"
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ================================ Màn chính ================================ */

export default function AttendanceHome() {
  const auth = useAuth();
  // Quản trị / phòng chuyên môn xem toàn phạm vi; giáo viên/trợ giảng chỉ của mình.
  const managerView = auth.can('attendance.viewAll') && !auth.isFieldStaff;
  const [tab, setTab] = useState(managerView ? 'pending' : 'today');

  const options = managerView
    ? [{ value: 'pending', label: 'Chưa điểm danh' }, { value: 'history', label: 'Lịch sử' }]
    : [{ value: 'today', label: 'Hôm nay' }, { value: 'history', label: 'Lịch sử' }];

  return (
    <div>
      <PageHeader
        title="Điểm danh"
        sub={managerView
          ? 'Theo dõi điểm danh các lớp trong phạm vi phụ trách'
          : 'Điểm danh sĩ số từng buổi dạy'}
      />
      <Segmented options={options} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'today' && !managerView && <TodayTab />}
      {tab === 'pending' && managerView && <PendingTab />}
      {tab === 'history' && <HistoryTab managerView={managerView} />}
    </div>
  );
}
