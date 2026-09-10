/**
 * AuditLog.jsx — Nhật ký hệ thống (chỉ admin — route đã Guard `audit.view` ở App).
 *
 * GET /api/audit?entity=&action=&from=&to=&q= + phân trang server.
 * Bấm một dòng → Sheet chi tiết hiện before_data/after_data dạng JSON,
 * so sánh 2 cột trên desktop.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';
import {
  Badge, EmptyState, ErrorBox, PageHeader, PageLoading, Pager, SearchBox, Sheet, Spinner,
} from '../../components/ui.jsx';

/* ------------------------------ Nhãn tiếng Việt ---------------------------- */

const ENTITY_OPTIONS = [
  ['', 'Tất cả đối tượng'],
  ['users', 'Tài khoản'],
  ['schools', 'Trường'],
  ['classes', 'Lớp'],
  ['rooms', 'Phòng'],
  ['schedules', 'Lịch dạy'],
  ['timesheets', 'Chấm công'],
  ['attendance', 'Điểm danh'],
  ['devices', 'Thiết bị'],
  ['device_issues', 'Sự cố thiết bị'],
  ['materials', 'Học liệu'],
  ['solutions', 'Giải pháp'],
  ['feedback', 'Góp ý'],
  ['files', 'Tệp'],
  ['auth', 'Phiên đăng nhập'],
];
const ENTITY_LABEL = Object.fromEntries(ENTITY_OPTIONS.filter(([v]) => v));

const ACTION_META = {
  create: { label: 'Tạo mới', tone: 'resolved' },
  update: { label: 'Cập nhật', tone: 'new' },
  delete: { label: 'Xoá', tone: 'urgent' },
  approve: { label: 'Duyệt', tone: 'approved' },
  login: { label: 'Đăng nhập', tone: 'neutral' },
  export: { label: 'Xuất dữ liệu', tone: 'high' },
};
const ACTION_OPTIONS = [['', 'Tất cả hành động'], ...Object.entries(ACTION_META).map(([v, m]) => [v, m.label])];

/* ------------------------------ Tiện ích nhỏ ------------------------------ */

/** Rút gọn id dài (uuid) để bảng không vỡ: 'a1b2c3d4…' */
function shortId(v) {
  const s = String(v ?? '');
  if (!s) return '';
  return s.length > 10 ? `${s.slice(0, 8)}…` : s;
}

/** before/after có thể là object hoặc chuỗi JSON — trả về chuỗi JSON đẹp. */
function prettyJson(v) {
  if (v === null || v === undefined) return '(trống)';
  let obj = v;
  if (typeof v === 'string') {
    try { obj = JSON.parse(v); } catch { return v; }
  }
  try { return JSON.stringify(obj, null, 2); } catch { return String(v); }
}

function actorOf(r) {
  return r.actor_name || r.actor?.full_name || r.actor_email || r.actor?.email
    || r.user_name || (r.actor_id ? `#${shortId(r.actor_id)}` : '—');
}

const timeOf = (r) => r.created_at || r.at || r.timestamp;

/* ---------------------------- Thành phần phụ ------------------------------- */

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-muted font-semibold uppercase">{label}</div>
      <div className="text-[13.5px] break-all">{value || '—'}</div>
    </div>
  );
}

function JsonPane({ title, data }) {
  return (
    <div className="min-w-0">
      <div className="label">{title}</div>
      <pre className="rounded-xl bg-ink text-white/90 text-[11.5px] leading-relaxed p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words">
        {prettyJson(data)}
      </pre>
    </div>
  );
}

/* ------------------------------- Màn hình ---------------------------------- */

const LIMIT = 50;

export default function AuditLog() {
  // Bộ lọc
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);   // tăng để nạp lại khi bấm "Thử lại"

  // Dữ liệu
  const [data, setData] = useState({ items: [], total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  // Đổi bộ lọc thì về trang 1.
  const applyFilter = (setter) => (v) => { setter(v); setPage(1); };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.get('/api/audit', { q, entity, action, from, to, page, limit: LIMIT })
      .then((res) => {
        if (!alive) return;
        setData({
          items: res?.items || (Array.isArray(res) ? res : []),
          total: res?.total ?? (res?.items?.length || 0),
        });
        setLoaded(true);
      })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, entity, action, from, to, page, tick]);

  const reload = () => setTick((t) => t + 1);

  const items = data.items;
  const hasFilter = useMemo(() => !!(q || entity || action || from || to), [q, entity, action, from, to]);

  if (!loaded) {
    if (error) return <ErrorBox error={error} onRetry={reload} />;
    return <PageLoading />;
  }

  return (
    <div>
      <PageHeader
        title="Nhật ký hệ thống"
        sub="Ai đã làm gì, khi nào — phục vụ kiểm tra và truy vết."
        actions={loading ? <Spinner /> : null}
      />

      {/* ------------------------------ Bộ lọc ----------------------------------- */}
      <div className="card p-3.5 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchBox
          className="sm:col-span-2 lg:col-span-4"
          value={q}
          onChange={applyFilter(setQ)}
          placeholder="Tìm theo nội dung, người thao tác…"
        />
        <div>
          <label className="label">Đối tượng</label>
          <select className="input" value={entity} onChange={(e) => applyFilter(setEntity)(e.target.value)}>
            {ENTITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Hành động</label>
          <select className="input" value={action} onChange={(e) => applyFilter(setAction)(e.target.value)}>
            {ACTION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Từ ngày</label>
          <input type="date" className="input" value={from} onChange={(e) => applyFilter(setFrom)(e.target.value)} />
        </div>
        <div>
          <label className="label">Đến ngày</label>
          <input type="date" className="input" value={to} onChange={(e) => applyFilter(setTo)(e.target.value)} />
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBox error={error} onRetry={reload} /></div>}

      {/* ------------------------------- Bảng ------------------------------------ */}
      {items.length === 0 && !loading ? (
        <EmptyState
          icon="🧾"
          title="Không có bản ghi nhật ký"
          hint={hasFilter
            ? 'Không tìm thấy bản ghi khớp bộ lọc. Hãy nới rộng khoảng ngày hoặc xoá bớt điều kiện.'
            : 'Hệ thống chưa ghi nhận thao tác nào.'}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="th">Thời gian</th>
                  <th className="th">Người thao tác</th>
                  <th className="th">Hành động</th>
                  <th className="th">Đối tượng</th>
                  <th className="th">Nội dung</th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-50' : ''}>
                {items.map((r, i) => {
                  const meta = ACTION_META[r.action];
                  return (
                    <tr
                      key={r.id || i}
                      className="hover:bg-brand-50/50 cursor-pointer"
                      onClick={() => setDetail(r)}>
                      <td className="td whitespace-nowrap">{fmtDateTime(timeOf(r))}</td>
                      <td className="td">{actorOf(r)}</td>
                      <td className="td">
                        <Badge tone={meta?.tone || 'neutral'}>{meta?.label || r.action || '—'}</Badge>
                      </td>
                      <td className="td whitespace-nowrap">
                        <span className="font-medium">{ENTITY_LABEL[r.entity] || r.entity || '—'}</span>
                        {r.entity_id && <span className="text-ink-muted"> #{shortId(r.entity_id)}</span>}
                      </td>
                      <td className="td max-w-[320px]">
                        <span className="line-clamp-2">{r.summary || ''}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />

      {/* ---------------------------- Sheet chi tiết ------------------------------ */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title="Chi tiết nhật ký" wide>
        {detail && (
          <div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
              <Meta label="Thời gian" value={fmtDateTime(timeOf(detail))} />
              <Meta label="Người thao tác" value={actorOf(detail)} />
              <Meta
                label="Hành động"
                value={ACTION_META[detail.action]?.label || detail.action}
              />
              <Meta
                label="Đối tượng"
                value={`${ENTITY_LABEL[detail.entity] || detail.entity || '—'}${detail.entity_id ? ` · ${detail.entity_id}` : ''}`}
              />
              {detail.ip_address && <Meta label="Địa chỉ IP" value={detail.ip_address} />}
            </div>

            {detail.summary && (
              <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-[13.5px] text-ink-soft mb-4">
                {detail.summary}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <JsonPane title="Trước thay đổi" data={detail.before_data} />
              <JsonPane title="Sau thay đổi" data={detail.after_data} />
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
