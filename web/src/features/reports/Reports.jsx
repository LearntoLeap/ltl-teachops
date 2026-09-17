/**
 * Reports.jsx — Báo cáo & xuất dữ liệu Excel (admin/manager — route đã Guard `report.view` ở App).
 *
 * Gồm 3 khối, dùng chung bộ lọc tháng + trường ở đầu trang:
 *   1. Ô số liệu nhanh từ GET /api/reports/dashboard.
 *   2. Xuất dữ liệu Excel — mỗi nút một tệp, trạng thái đang tải riêng từng nút.
 *   3. Đối chiếu chấm công (kế hoạch ↔ thực tế) từ GET /api/timesheets/reconcile.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtDate, fmtDuration, fmtNumber, monthRange, today } from '../../lib/format.js';
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoading, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import ExportPreview, { PreviewCount, PreviewTable, usePreview } from './ExportPreview.jsx';

/* ------------------------------ Tiện ích nhỏ ------------------------------ */

/** Lấy giá trị đầu tiên có mặt trong object theo danh sách khoá dự phòng. */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** 'YYYY-MM' → { from: 'YYYY-MM-01', to: ngày cuối tháng } */
function rangeOfMonth(monthStr) {
  return monthRange(new Date(`${monthStr}-01T00:00:00`));
}

/** 0.92 hoặc 92 → '92%' */
function asPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

/* --------------------------- Cấu hình hiển thị ----------------------------- */

/**
 * Ô số liệu nhanh — đọc đúng hình dạng /api/reports/dashboard trả về:
 * { today: {...}, open_issues: {new, in_progress}, feedback_new, flagged_timesheets }.
 * Đây là số liệu CỦA HÔM NAY, không theo tháng đang lọc — nên có tiêu đề riêng.
 */
const DASH_TILES = [
  { label: 'Buổi dạy hôm nay', icon: '🗓️', get: (d) => d.today?.sessions },
  { label: 'Đã chấm công', icon: '📍', get: (d) => d.today?.checked_in },
  { label: 'Trễ giờ', icon: '⏰', get: (d) => d.today?.late },
  { label: 'Điểm danh còn thiếu', icon: '📋', get: (d) => d.today?.attendance_pending },
  { label: 'Thiết bị hỏng đang mở', icon: '🛠️', get: (d) => (d.open_issues?.new ?? 0) + (d.open_issues?.in_progress ?? 0) },
  { label: 'Góp ý mới', icon: '📨', get: (d) => d.feedback_new },
];

const EXPORTS = [
  { key: 'timesheets', path: '/api/reports/timesheets.xlsx', file: 'timesheets.xlsx', label: 'Bảng chấm công', icon: '📍' },
  { key: 'payroll', path: '/api/reports/payroll.xlsx', file: 'payroll.xlsx', label: 'Tổng hợp tính lương', icon: '💰' },
  { key: 'attendance', path: '/api/reports/attendance.xlsx', file: 'attendance.xlsx', label: 'Điểm danh', icon: '📋' },
  { key: 'devices', path: '/api/reports/devices.xlsx', file: 'devices.xlsx', label: 'Thiết bị', icon: '🛠️' },
  { key: 'feedback', path: '/api/reports/feedback.xlsx', file: 'feedback.xlsx', label: 'Góp ý', icon: '📨' },
  { key: 'users', path: '/api/reports/users.xlsx', file: 'users.xlsx', label: 'Tài khoản', icon: '👥', adminOnly: true },
];

/* ---------------------------- Thành phần phụ ------------------------------- */

function StatTile({ icon, label, value }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="text-[13px] text-ink-muted flex items-center gap-1.5">
        <span>{icon}</span> {label}
      </div>
      <div className="text-2xl font-extrabold text-brand-800">{value}</div>
    </div>
  );
}

function SummaryChip({ label, value, cls = 'bg-brand-50 text-brand-800' }) {
  return (
    <div className={`rounded-xl px-3 py-1.5 text-[12.5px] font-semibold ${cls}`}>
      {label}: <span className="font-bold">{fmtNumber(value)}</span>
    </div>
  );
}

/** Mục xuất "Bảng chấm công" — dùng lại cho bảng xem theo tháng bên dưới. */
const TIMESHEET_EXPORT = EXPORTS.find((e) => e.key === 'timesheets');

/**
 * Bảng chấm công của tháng đang chọn, hiện thẳng trên trang.
 * Dùng chính bản xem trước của tệp Excel nên số liệu khớp tuyệt đối với tệp tải về.
 */
function MonthlyTimesheet({ query, month, onDownload, downloading }) {
  const [open, setOpen] = useState(true);
  const { data, error, reload } = usePreview(TIMESHEET_EXPORT.path, query, open);
  const sheet = data?.sheets?.[0];
  const [mm, yyyy] = [month.slice(5, 7), month.slice(0, 4)];

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="font-bold text-[15px] flex items-center gap-1.5 hover:text-brand-800">
          <span className="text-[13px]">{open ? '▾' : '▸'}</span>
          📍 Bảng chấm công tháng {mm}/{yyyy}
        </button>
        {open && (
          <button type="button" className="btn-line !py-1.5 !px-3 ml-auto" onClick={onDownload} disabled={downloading}>
            {downloading ? <Spinner className="h-4 w-4" /> : '⬇ Tải tháng này'}
          </button>
        )}
      </div>

      {open && (
        <>
          {error && <ErrorBox error={error} onRetry={reload} />}
          {!error && !data && (
            <div className="flex items-center gap-2 text-[13.5px] text-ink-muted py-4">
              <Spinner className="h-4 w-4" /> Đang lấy bảng chấm công…
            </div>
          )}
          {data && (
            <>
              <PreviewTable sheet={sheet} dense />
              <PreviewCount sheet={sheet} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------- Màn hình ---------------------------------- */

export default function Reports() {
  const auth = useAuth();
  const toast = useToast();

  // Bộ lọc chung
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState([]);
  const { from, to } = useMemo(() => rangeOfMonth(month), [month]);

  // Dữ liệu
  const [dash, setDash] = useState(null);
  const [recon, setRecon] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState('');
  const [visible, setVisible] = useState(50);
  const [previewing, setPreviewing] = useState(null);   // mục xuất đang xem trước

  // Bộ lọc dùng chung cho cả xem trước lẫn tải tệp — luôn khớp tháng đang chọn.
  const exportQuery = useMemo(
    () => ({ from, to, school_id: schoolId || undefined }),
    [from, to, schoolId]
  );

  /* ------------------------------ Nạp dữ liệu ------------------------------ */
  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const q = { from, to, school_id: schoolId };
      const [d, r] = await Promise.all([
        api.get('/api/reports/dashboard', q),
        api.get('/api/timesheets/reconcile', q),
      ]);
      setDash(d);
      setRecon(r);
      setVisible(50);
      setLoaded(true);
    } catch (e) {
      setError(e);
    } finally {
      setRefreshing(false);
    }
  }, [from, to, schoolId]);

  useEffect(() => { load(); }, [load]);

  // Danh sách trường cho bộ lọc — lỗi thì dùng phạm vi trường từ hồ sơ đăng nhập.
  useEffect(() => {
    let alive = true;
    api.get('/api/schools', { limit: 200 })
      .then((res) => { if (alive) setSchools(res?.items || (Array.isArray(res) ? res : [])); })
      .catch(() => { if (alive) setSchools(auth.schools || []); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------- Xuất Excel ------------------------------ */
  const exportList = EXPORTS.filter((e) => !e.adminOnly || auth.isAdmin);

  const doDownload = async (exp) => {
    if (downloading) return;
    setDownloading(exp.key);
    try {
      const name = await api.download(exp.path, exportQuery, exp.file);
      toast.ok('Đã tải ' + name);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDownloading('');
    }
  };

  /* ----------------------------- Số liệu nhanh ----------------------------- */
  const tiles = useMemo(() => {
    if (!dash || typeof dash !== 'object') return [];
    return DASH_TILES.map((t) => {
      const v = t.get(dash);
      // Chỉ hiện ô khi có SỐ thật — thà bỏ ô còn hơn in ra NaN.
      return Number.isFinite(Number(v)) ? { ...t, value: fmtNumber(Number(v)) } : null;
    }).filter(Boolean);
  }, [dash]);

  /* ---------------------------- Đối chiếu chấm công ------------------------- */
  const rows = useMemo(() => {
    if (!recon) return [];
    if (Array.isArray(recon)) return recon;
    return recon.items || recon.rows || recon.data || [];
  }, [recon]);

  const s = useMemo(() => {
    const sum = (recon && !Array.isArray(recon) && recon.summary) || {};
    const count = (fn) => rows.filter(fn).length;
    return {
      total: pick(sum, ['total', 'total_sessions']) ?? rows.length,
      ontime: pick(sum, ['ontime', 'ontime_count']) ?? count((r) => r.label === 'ontime'),
      late: pick(sum, ['late', 'late_count']) ?? count((r) => r.label === 'late'),
      absent: pick(sum, ['absent', 'absent_count']) ?? count((r) => r.label === 'absent'),
      gps: pick(sum, ['gps_flagged', 'gps_flagged_count']) ?? count((r) => r.gps_flagged),
      pending: pick(sum, ['pending', 'pending_count']) ?? count((r) => r.approval_status === 'pending'),
    };
  }, [recon, rows]);

  /* --------------------------------- Render -------------------------------- */
  if (!loaded) {
    if (error) return <ErrorBox error={error} onRetry={load} />;
    return <PageLoading />;
  }

  return (
    <div>
      <ExportPreview
        open={!!previewing}
        exp={previewing}
        query={exportQuery}
        onClose={() => setPreviewing(null)}
      />

      <PageHeader
        title="Báo cáo & xuất dữ liệu"
        sub={`Kỳ ${fmtDate(from)} – ${fmtDate(to)}`}
        actions={refreshing ? <Spinner /> : null}
      />

      {/* ------------------------------ Bộ lọc chung ----------------------------- */}
      <div className="card p-3.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Tháng</label>
          <input
            type="month"
            className="input !w-auto"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </div>
        <div className="min-w-[190px]">
          <label className="label">Trường</label>
          <select className="input" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">Tất cả trường</option>
            {schools.map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.name || sc.school_name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBox error={error} onRetry={load} /></div>}

      {/* ---------------------------- Ô số liệu nhanh ---------------------------- */}
      {tiles.length > 0 && (
        <h2 className="font-bold text-[15px] mb-2.5">
          ⚡ Hôm nay <span className="font-normal text-[12.5px] text-ink-muted">— không phụ thuộc tháng đang lọc</span>
        </h2>
      )}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {tiles.map((t) => (
            <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} />
          ))}
        </div>
      )}

      {/* --------------------------- Xuất dữ liệu Excel --------------------------- */}
      <h2 className="font-bold text-[15px] mb-2.5">📥 Xuất dữ liệu Excel</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {exportList.map((exp) => (
          <div key={exp.key} className="card p-4 flex items-center gap-3">
            <span className="text-2xl shrink-0">{exp.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[14px]">{exp.label}</span>
              <span className="block text-[12px] text-ink-muted truncate">{exp.file}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                title="Xem trước nội dung sẽ xuất"
                onClick={() => setPreviewing(exp)}
                className="h-9 px-2.5 rounded-xl text-[12.5px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100">
                👁 Xem trước
              </button>
              <button
                type="button"
                title={`Tải ${exp.file}`}
                onClick={() => doDownload(exp)}
                disabled={!!downloading}
                className="h-9 w-9 grid place-items-center rounded-xl text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                {downloading === exp.key ? <Spinner className="h-4 w-4" /> : <span className="text-lg font-bold" aria-hidden>⬇</span>}
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* ------------------------ Bảng chấm công theo tháng ----------------------- */}
      <MonthlyTimesheet query={exportQuery} month={month} onDownload={() => doDownload(TIMESHEET_EXPORT)}
        downloading={downloading === TIMESHEET_EXPORT.key} />

      {/* -------------------------- Đối chiếu chấm công --------------------------- */}
      <h2 className="font-bold text-[15px] mb-2.5">🧮 Đối chiếu chấm công</h2>

      <div className="flex flex-wrap gap-2 mb-3">
        <SummaryChip label="Tổng buổi" value={s.total} />
        <SummaryChip label="Đúng giờ" value={s.ontime} cls="bg-emerald-50 text-emerald-700" />
        <SummaryChip label="Trễ" value={s.late} cls="bg-amber-50 text-amber-700" />
        <SummaryChip label="Vắng" value={s.absent} cls="bg-rose-50 text-rose-700" />
        <SummaryChip label="Lệch GPS" value={s.gps} cls="bg-amber-50 text-amber-700" />
        <SummaryChip label="Chờ duyệt" value={s.pending} cls="bg-sky-50 text-sky-700" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="🧮"
          title="Không có dữ liệu đối chiếu"
          hint="Trong kỳ đã chọn chưa có buổi dạy nào. Hãy thử chọn tháng khác hoặc bỏ lọc trường."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px]">
              <thead>
                <tr>
                  <th className="th">Ngày</th>
                  <th className="th">Trường</th>
                  <th className="th">Lớp</th>
                  <th className="th">Người dạy</th>
                  <th className="th">Trạng thái</th>
                  <th className="th">Trễ</th>
                  <th className="th">Làm việc</th>
                  <th className="th">GPS</th>
                  <th className="th">Duyệt</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, visible).map((r, i) => (
                  <tr key={r.id || `${r.schedule_id || ''}-${r.user_id || ''}-${i}`}>
                    <td className="td whitespace-nowrap">{fmtDate(r.date || r.session_date || r.day)}</td>
                    <td className="td">{r.school_name || r.school?.name || '—'}</td>
                    <td className="td">{r.class_name || r.class?.name || '—'}</td>
                    <td className="td">{r.user_name || r.full_name || r.user?.full_name || '—'}</td>
                    <td className="td">
                      {r.label
                        ? <Badge tone={r.label}>{LABEL.attend[r.label] || r.label}</Badge>
                        : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="td whitespace-nowrap">{fmtDuration(r.late_minutes)}</td>
                    <td className="td whitespace-nowrap">{fmtDuration(r.worked_minutes)}</td>
                    <td className="td">
                      {r.gps_flagged
                        ? <Badge tone="high">⚑ Lệch GPS</Badge>
                        : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="td">
                      {r.approval_status
                        ? <Badge tone={r.approval_status}>{LABEL.approval[r.approval_status] || r.approval_status}</Badge>
                        : <span className="text-ink-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > visible && (
            <div className="p-3 text-center border-t border-line">
              <button className="btn-line !py-1.5" onClick={() => setVisible((v) => v + 50)}>
                Xem thêm ({fmtNumber(rows.length - visible)} dòng)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
