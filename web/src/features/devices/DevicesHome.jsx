/**
 * DevicesHome.jsx — Màn hình Thiết bị, 3 tab:
 *   - Kiểm kê : kiểm đếm thiết bị phòng theo 4 mốc trong ngày (theo cấu hình trường).
 *   - Báo hỏng: gửi & xử lý sự cố thiết bị, xuất Excel.
 *   - Danh mục: quản trị danh mục thiết bị chuẩn của từng phòng (admin/manager).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtAgo, fmtDate, fmtDateLong, fmtTime, today } from '../../lib/format.js';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Pager, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';

/* ------------------------------ Tiện ích chung ----------------------------- */

/** Thứ tự chuẩn của 4 mốc kiểm kê trong ngày. */
const SLOT_KEYS = ['morning_start', 'morning_end', 'afternoon_start', 'afternoon_end'];

/** Danh sách từ server có thể là mảng trần hoặc bọc {items, total}. */
const unwrap = (res) => (Array.isArray(res) ? res : res?.items || []);

/** Lấy danh sách id ảnh của bản ghi, chấp nhận nhiều dạng dữ liệu server trả. */
function photoIds(rec) {
  const arr = rec?.photos || rec?.photo_ids || rec?.files || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => (p && typeof p === 'object' ? p.file_id || p.id : p)).filter(Boolean);
}

/** Tên người thao tác trên bản ghi (người kiểm / người báo). */
function personName(rec) {
  return rec?.checked_by_name || rec?.reported_by_name || rec?.created_by_name
    || rec?.checker?.full_name || rec?.reporter?.full_name || rec?.user?.full_name
    || rec?.created_by?.full_name || '—';
}

/** Bản ghi kiểm kê có lệch so với chuẩn không: true/false, hoặc null nếu không rõ. */
function checkMismatch(c) {
  if (typeof c?.has_mismatch === 'boolean') return c.has_mismatch;
  if (typeof c?.mismatch === 'boolean') return c.mismatch;
  if (Array.isArray(c?.items)) {
    return c.items.some((it) => it?.expected_qty != null && Number(it.qty) !== Number(it.expected_qty));
  }
  return null;
}

/** Dải ảnh thu nhỏ — bấm mở bản đầy đủ ở tab mới. */
function PhotoStrip({ rec, size = 'h-9 w-9' }) {
  const ids = photoIds(rec);
  if (!ids.length) return <span className="text-ink-muted text-[12px]">—</span>;
  return (
    <div className="flex gap-1.5 items-center">
      {ids.slice(0, 4).map((id) => (
        <a key={id} href={fileUrl(id)} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={fileUrl(id, { thumb: true })} alt="Ảnh minh chứng"
            className={`${size} rounded-lg object-cover border border-line`} />
        </a>
      ))}
      {ids.length > 4 && <span className="text-[11px] text-ink-muted">+{ids.length - 4}</span>}
    </div>
  );
}

/* --------------------------- Chọn trường & phòng --------------------------- */

function SchoolRoomPicker({ schools, schoolId, onSchool, rooms, roomId, onRoom, loading }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <div>
        <label className="label">Trường</label>
        <select className="input" value={schoolId} onChange={(e) => onSchool(e.target.value)}>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Phòng {loading && <Spinner className="!h-3.5 !w-3.5 ml-1" />}</label>
        <select className="input" value={roomId} onChange={(e) => onRoom(e.target.value)} disabled={!rooms.length}>
          {rooms.length === 0 && <option value="">— Chưa có phòng —</option>}
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ================================ TAB KIỂM KÊ =============================== */

function CheckTab({ schoolId, roomId, roomsLoading, hasRooms }) {
  const auth = useAuth();
  const [school, setSchool] = useState(null);
  const [schoolErr, setSchoolErr] = useState(null);
  const [todayChecks, setTodayChecks] = useState(null);
  const [history, setHistory] = useState(null);
  const [checksErr, setChecksErr] = useState(null);
  const [formSlot, setFormSlot] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Cấu hình mốc kiểm kê (device_slots) của trường.
  useEffect(() => {
    if (!schoolId) { setSchool(null); return undefined; }
    let alive = true;
    setSchool(null);
    setSchoolErr(null);
    api.get(`/api/schools/${schoolId}`)
      .then((res) => { if (alive) setSchool(res); })
      .catch((e) => { if (alive) setSchoolErr(e); });
    return () => { alive = false; };
  }, [schoolId, reloadTick]);

  const loadChecks = useCallback(async () => {
    if (!roomId) { setTodayChecks([]); setHistory([]); return; }
    setChecksErr(null);
    try {
      const [t, h] = await Promise.all([
        api.get('/api/devices/checks', { room_id: roomId, date: today() }),
        api.get('/api/devices/checks', { room_id: roomId, limit: 30 }),
      ]);
      setTodayChecks(unwrap(t));
      setHistory(unwrap(h));
    } catch (e) { setChecksErr(e); }
  }, [roomId]);

  useEffect(() => { setTodayChecks(null); setHistory(null); loadChecks(); }, [loadChecks]);

  if (roomsLoading) return <PageLoading label="Đang tải danh sách phòng…" />;
  if (!hasRooms || !roomId) {
    return (
      <EmptyState icon="🚪" title="Trường chưa có phòng thiết bị"
        hint={auth.can('org.manage')
          ? 'Vào mục Trường & Lớp để thêm phòng cho trường này.'
          : 'Liên hệ Phòng chuyên môn để khai báo phòng thiết bị.'} />
    );
  }
  if (schoolErr) return <ErrorBox error={schoolErr} onRetry={() => setReloadTick((n) => n + 1)} />;
  if (checksErr) return <ErrorBox error={checksErr} onRetry={loadChecks} />;
  if (!school || todayChecks === null || history === null) return <PageLoading />;

  // Chỉ hiện các mốc trường có cấu hình; thiếu cấu hình → hiện đủ 4 mốc.
  const slots = Array.isArray(school.device_slots)
    ? SLOT_KEYS.filter((k) => school.device_slots.includes(k))
    : SLOT_KEYS;

  return (
    <div>
      <div className="text-[13px] text-ink-muted mb-2.5">Hôm nay — {fmtDateLong(today())}</div>

      {slots.length === 0 ? (
        <EmptyState icon="⏰" title="Trường chưa cấu hình mốc kiểm kê"
          hint={auth.can('org.manage')
            ? 'Vào Trường & Lớp → sửa trường để chọn các mốc kiểm kê trong ngày.'
            : 'Liên hệ Phòng chuyên môn để cấu hình mốc kiểm kê cho trường.'} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {slots.map((slot) => {
            const done = todayChecks.find((c) => c.slot === slot);
            if (done) {
              return (
                <div key={slot} className="card p-3.5 border-emerald-200 bg-emerald-50/50">
                  <div className="text-[13px] font-semibold text-ink">{LABEL.slot[slot]}</div>
                  <div className="text-emerald-700 text-[12.5px] font-semibold mt-1">
                    ✓ Đã kiểm{fmtTime(done.created_at || done.checked_at) ? ` · ${fmtTime(done.created_at || done.checked_at)}` : ''}
                  </div>
                  <div className="text-[11.5px] text-ink-muted mt-0.5 truncate">{personName(done)}</div>
                </div>
              );
            }
            return (
              <button key={slot} type="button"
                disabled={!auth.can('device.check')}
                onClick={() => setFormSlot(slot)}
                className="card p-3.5 text-left hover:border-brand-300 transition disabled:opacity-60">
                <div className="text-[13px] font-semibold text-ink">{LABEL.slot[slot]}</div>
                <div className="text-amber-600 text-[12.5px] font-semibold mt-1">○ Chưa kiểm</div>
                {auth.can('device.check') && (
                  <div className="text-[11.5px] text-brand-600 mt-0.5">Bấm để kiểm kê →</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ----------------------- Lịch sử kiểm kê ----------------------- */}
      <h2 className="text-[14.5px] font-bold text-ink mt-6 mb-2.5">Lịch sử kiểm kê</h2>
      {history.length === 0 ? (
        <EmptyState icon="📋" title="Chưa có lần kiểm kê nào"
          hint="Bấm vào một mốc chưa kiểm ở trên để bắt đầu kiểm kê phòng này." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr>
                  <th className="th">Ngày</th>
                  <th className="th">Mốc</th>
                  <th className="th">Người kiểm</th>
                  <th className="th">Lệch?</th>
                  <th className="th">Ảnh</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => {
                  const mm = checkMismatch(c);
                  return (
                    <tr key={c.id}>
                      <td className="td whitespace-nowrap">{fmtDate(c.check_date || c.date || c.created_at)}</td>
                      <td className="td whitespace-nowrap">{LABEL.slot[c.slot] || c.slot}</td>
                      <td className="td">{personName(c)}</td>
                      <td className="td">
                        {mm === true && <Badge tone="urgent">Lệch</Badge>}
                        {mm === false && <Badge tone="approved">Đủ</Badge>}
                        {mm === null && <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="td"><PhotoStrip rec={c} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CheckFormSheet
        open={!!formSlot}
        slot={formSlot}
        roomId={roomId}
        onClose={() => setFormSlot(null)}
        onDone={() => { setFormSlot(null); loadChecks(); }}
      />
    </div>
  );
}

/* ----------------------------- Form kiểm kê phòng --------------------------- */

function CheckFormSheet({ open, slot, roomId, onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);       // null = đang tải danh mục
  const [catalogErr, setCatalogErr] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    setRows(null);
    setCatalogErr(null);
    try {
      const list = unwrap(await api.get('/api/devices/catalog', { room_id: roomId, limit: 200 }));
      setRows(list.map((it) => ({ ...it, qty: String(it.expected_qty ?? 0), noteText: '' })));
    } catch (e) { setCatalogErr(e); }
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setNote('');
    loadCatalog();
  }, [open, loadCatalog]);

  const isDiff = (r) => r.expected_qty != null && r.qty !== '' && Number(r.qty) !== Number(r.expected_qty);

  const setRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (busy) return;
    if (!photos.length) {
      toast.err('Vui lòng chụp ít nhất 1 ảnh thực tế phòng.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('room_id', String(roomId));
      fd.append('slot', slot);
      fd.append('items', JSON.stringify((rows || []).map((r) => ({
        catalog_id: r.id,
        qty: Number(r.qty || 0),
        note: r.noteText.trim(),
      }))));
      if (note.trim()) fd.append('note', note.trim());
      photos.forEach((p) => fd.append('photos', p.blob, p.name));
      await api.upload('/api/devices/checks', fd);
      toast.ok('Đã ghi nhận kiểm kê.');
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide
      title={slot ? `Kiểm kê · ${LABEL.slot[slot]}` : 'Kiểm kê'}>
      {catalogErr && <ErrorBox error={catalogErr} onRetry={loadCatalog} />}
      {!catalogErr && rows === null && <PageLoading label="Đang tải danh mục thiết bị…" />}

      {rows !== null && !catalogErr && (
        <>
          {rows.length === 0 ? (
            <div className="rounded-xl bg-brand-50 border border-brand-200 text-brand-800 text-[13px] px-3.5 py-2.5 mb-3">
              Phòng chưa có danh mục thiết bị — vẫn có thể ghi nhận ảnh và ghi chú.
            </div>
          ) : (
            <div className="mb-1">
              {rows.map((r, idx) => {
                const diff = isDiff(r);
                return (
                  <div key={r.id}
                    className={`rounded-xl border px-3 py-2.5 mb-2 transition ${diff ? 'border-rose-300 bg-rose-50/60' : 'border-line'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13.5px] font-semibold truncate ${diff ? 'text-rose-700' : 'text-ink'}`}>{r.name}</div>
                        <div className={`text-[11.5px] ${diff ? 'text-rose-600 font-semibold' : 'text-ink-muted'}`}>
                          Chuẩn: {r.expected_qty ?? '—'}{r.unit ? ` ${r.unit}` : ''}
                        </div>
                      </div>
                      <input
                        type="number" min="0" inputMode="numeric"
                        className={`input !w-20 text-center ${diff ? '!border-rose-400 text-rose-700 font-bold' : ''}`}
                        value={r.qty}
                        onChange={(e) => setRow(idx, { qty: e.target.value })}
                      />
                    </div>
                    <input
                      className="input !py-1.5 mt-2 text-[13px]"
                      placeholder="Ghi chú ngắn (nếu lệch/hỏng)…"
                      value={r.noteText}
                      onChange={(e) => setRow(idx, { noteText: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <PhotoInput
            value={photos}
            onChange={setPhotos}
            required
            label="Ảnh thực tế phòng"
            hint="Chụp bao quát phòng, thấy rõ khu vực để thiết bị."
          />

          <Field label="Ghi chú chung">
            <textarea className="input" rows={2} placeholder="Tình trạng chung của phòng…"
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <div className="flex gap-2.5 justify-end mt-1">
            <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? <Spinner className="!h-4 !w-4 border-white/40 border-t-white" /> : 'Gửi kiểm kê'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ================================ TAB BÁO HỎNG ============================== */

const ISSUE_FILTERS = [
  { value: 'new', label: 'Mới' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'resolved', label: 'Đã khắc phục' },
  { value: '', label: 'Tất cả' },
];

function IssuesTab({ schools, defaultSchoolId }) {
  const auth = useAuth();
  const toast = useToast();
  const limit = 20;
  const [status, setStatus] = useState('new');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);       // {items, total}
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/devices/issues', { status, page, limit });
      const items = unwrap(res);
      setData({ items, total: res?.total ?? items.length });
    } catch (e) { setError(e); }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const exportXlsx = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await api.download('/api/reports/devices.xlsx', undefined, 'bao-cao-thiet-bi.xlsx');
      toast.ok('Đã tải tệp Excel về máy.');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3.5">
        <Segmented options={ISSUE_FILTERS} value={status}
          onChange={(v) => { setStatus(v); setPage(1); }} />
        <div className="flex items-center gap-2">
          {auth.can('export.scope') && (
            <button className="btn-line !py-2" onClick={exportXlsx} disabled={exporting}>
              {exporting ? <Spinner className="!h-4 !w-4" /> : '⬇️'} Xuất Excel
            </button>
          )}
          <button className="btn-primary !py-2" onClick={() => setFormOpen(true)}>+ Báo hỏng</button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && data === null && <PageLoading />}

      {data !== null && !error && (
        data.items.length === 0 ? (
          <EmptyState icon="🛠️" title="Không có báo hỏng nào"
            hint={status ? 'Thử chuyển bộ lọc sang "Tất cả" để xem toàn bộ.' : 'Thiết bị gặp sự cố? Hãy báo ngay để được xử lý.'}
            action={<button className="btn-primary" onClick={() => setFormOpen(true)}>+ Báo hỏng</button>} />
        ) : (
          <>
            <div className="grid gap-2.5">
              {data.items.map((it) => (
                <IssueCard key={it.id} issue={it}
                  canResolve={auth.can('device.resolveIssue')}
                  onChangeStatus={() => setStatusTarget(it)} />
              ))}
            </div>
            <Pager page={page} limit={limit} total={data.total} onPage={setPage} />
          </>
        )
      )}

      <IssueFormSheet
        open={formOpen}
        schools={schools}
        defaultSchoolId={defaultSchoolId}
        onClose={() => setFormOpen(false)}
        onDone={() => { setFormOpen(false); setPage(1); load(); }}
      />
      <IssueStatusSheet
        issue={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={() => { setStatusTarget(null); load(); }}
      />
    </div>
  );
}

function IssueCard({ issue, canResolve, onChangeStatus }) {
  const name = issue.device_name || issue.catalog_name || issue.catalog?.name || issue.name || 'Thiết bị';
  const place = [issue.school_name || issue.school?.name, issue.room_name || issue.room?.name]
    .filter(Boolean).join(' · ');
  return (
    <div className="card p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 font-semibold text-[14.5px] text-ink">
          {name}
          {issue.qty != null && <span className="text-ink-muted font-normal"> × {issue.qty}</span>}
        </div>
        <Badge tone={issue.priority}>{LABEL.priority[issue.priority] || issue.priority}</Badge>
        <Badge tone={issue.status}>{LABEL.issue[issue.status] || issue.status}</Badge>
      </div>

      {issue.description && <p className="text-[13.5px] text-ink-soft mt-1.5">{issue.description}</p>}

      {photoIds(issue).length > 0 && (
        <div className="mt-2.5"><PhotoStrip rec={issue} size="h-14 w-14" /></div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted mt-2.5">
        {place && <span>🏫 {place}</span>}
        <span>👤 {personName(issue)}</span>
        <span>🕒 {fmtAgo(issue.created_at)}</span>
      </div>

      {issue.status === 'resolved' && issue.resolution && (
        <div className="mt-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] px-3 py-2">
          ✓ Khắc phục: {issue.resolution}
        </div>
      )}

      {canResolve && (
        <div className="mt-3">
          <button className="btn-line !py-1.5 text-[13px]" onClick={onChangeStatus}>🔧 Đổi trạng thái</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Form báo hỏng ------------------------------ */

function IssueFormSheet({ open, onClose, onDone, schools, defaultSchoolId }) {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [catalogId, setCatalogId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [qty, setQty] = useState('1');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);

  // Reset form mỗi lần mở.
  useEffect(() => {
    if (!open) return;
    setSchoolId(String(defaultSchoolId || schools[0]?.id || ''));
    setCatalogId('');
    setDeviceName('');
    setQty('1');
    setDescription('');
    setPriority('normal');
    setPhotos([]);
  }, [open, defaultSchoolId, schools]);

  // Phòng theo trường đã chọn.
  useEffect(() => {
    if (!open || !schoolId) { setRooms([]); setRoomId(''); return undefined; }
    let alive = true;
    api.get('/api/rooms', { school_id: schoolId, limit: 200 })
      .then((res) => {
        if (!alive) return;
        const list = unwrap(res);
        setRooms(list);
        setRoomId(String(list[0]?.id ?? ''));
      })
      .catch(() => { if (alive) { setRooms([]); setRoomId(''); } });
    return () => { alive = false; };
  }, [open, schoolId]);

  // Danh mục theo phòng đã chọn.
  useEffect(() => {
    setCatalogId('');
    if (!open || !roomId) { setCatalog([]); return undefined; }
    let alive = true;
    api.get('/api/devices/catalog', { room_id: roomId, limit: 200 })
      .then((res) => { if (alive) setCatalog(unwrap(res)); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, [open, roomId]);

  const submit = async () => {
    if (busy) return;
    if (!schoolId) { toast.err('Vui lòng chọn trường.'); return; }
    const typedName = deviceName.trim();
    if (!catalogId && !typedName) { toast.err('Vui lòng chọn thiết bị hoặc nhập tên thiết bị.'); return; }
    if (!description.trim()) { toast.err('Vui lòng mô tả tình trạng hỏng.'); return; }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('school_id', String(schoolId));
      if (roomId) fd.append('room_id', String(roomId));
      if (catalogId) {
        fd.append('catalog_id', String(catalogId));
        const cat = catalog.find((c) => String(c.id) === String(catalogId));
        if (cat?.name) fd.append('device_name', cat.name);
      } else {
        fd.append('device_name', typedName);
      }
      fd.append('quantity', String(Math.max(1, Number(qty) || 1))); // server đọc field 'quantity'
      fd.append('description', description.trim());
      fd.append('priority', priority);
      photos.forEach((p) => fd.append('photos', p.blob, p.name));
      await api.upload('/api/devices/issues', fd);
      toast.ok('Đã gửi báo hỏng.');
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Báo hỏng thiết bị" wide>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Trường" required>
          <select className="input" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Phòng">
          <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!rooms.length}>
            {rooms.length === 0 && <option value="">— Chưa có phòng —</option>}
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Thiết bị" required hint={catalog.length ? '' : 'Phòng chưa có danh mục — hãy nhập tên thiết bị bên dưới.'}>
        <select className="input" value={catalogId} onChange={(e) => setCatalogId(e.target.value)} disabled={!catalog.length}>
          <option value="">— Nhập tay tên thiết bị —</option>
          {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      {!catalogId && (
        <Field label="Tên thiết bị (nhập tay)" required>
          <input className="input" placeholder="VD: Robot UGOT số 3, máy chiếu…"
            value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Số lượng" required>
          <input className="input" type="number" min="1" inputMode="numeric"
            value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Mức ưu tiên">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(LABEL.priority).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Mô tả tình trạng" required>
        <textarea className="input" rows={3} placeholder="Hỏng thế nào, ảnh hưởng gì tới buổi dạy…"
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <PhotoInput value={photos} onChange={setPhotos} label="Ảnh thiết bị hỏng"
        hint="Chụp rõ vị trí hỏng để đội xử lý chuẩn bị linh kiện." />

      <div className="flex gap-2.5 justify-end mt-1">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner className="!h-4 !w-4 border-white/40 border-t-white" /> : 'Gửi báo hỏng'}
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------- Đổi trạng thái sự cố -------------------------- */

function IssueStatusSheet({ issue, onClose, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState('in_progress');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!issue) return;
    setStatus(issue.status === 'new' ? 'in_progress' : issue.status);
    setResolution(issue.resolution || '');
  }, [issue]);

  const submit = async () => {
    if (busy || !issue) return;
    if (status === 'resolved' && !resolution.trim()) {
      toast.err('Vui lòng nhập nội dung đã khắc phục.');
      return;
    }
    setBusy(true);
    try {
      const body = { status };
      if (resolution.trim()) body.resolution = resolution.trim();
      await api.patch(`/api/devices/issues/${issue.id}`, body);
      toast.ok('Đã cập nhật trạng thái.');
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!issue} onClose={busy ? undefined : onClose} title="Đổi trạng thái sự cố">
      {issue && (
        <>
          <div className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3.5 text-[13.5px]">
            <span className="font-semibold">{issue.device_name || issue.catalog_name || issue.catalog?.name || 'Thiết bị'}</span>
            <span className="text-ink-muted"> — hiện tại: {LABEL.issue[issue.status] || issue.status}</span>
          </div>

          <Field label="Trạng thái mới" required>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(LABEL.issue).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          <Field label="Nội dung khắc phục" required={status === 'resolved'}
            hint={status === 'resolved' ? 'Bắt buộc khi chuyển sang "Đã khắc phục".' : 'Không bắt buộc ở trạng thái này.'}>
            <textarea className="input" rows={3} placeholder="Đã sửa/thay thế gì, khi nào…"
              value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>

          <div className="flex gap-2.5 justify-end mt-1">
            <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? <Spinner className="!h-4 !w-4 border-white/40 border-t-white" /> : 'Cập nhật'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ================================ TAB DANH MỤC ============================== */

function CatalogTab({ roomId, roomsLoading, hasRooms }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // null | {} (thêm mới) | item (sửa)
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) { setItems([]); return; }
    setError(null);
    try {
      const list = unwrap(await api.get('/api/devices/catalog', { room_id: roomId, limit: 200 }));
      setItems([...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
    } catch (e) { setError(e); }
  }, [roomId]);

  useEffect(() => { setItems(null); load(); }, [load]);

  const confirmDelete = async () => {
    if (deleteBusy || !deleting) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/devices/catalog/${deleting.id}`);
      toast.ok('Đã xoá thiết bị khỏi danh mục.');
      setDeleting(null);
      load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (roomsLoading) return <PageLoading label="Đang tải danh sách phòng…" />;
  if (!hasRooms || !roomId) {
    return (
      <EmptyState icon="🚪" title="Trường chưa có phòng thiết bị"
        hint="Vào mục Trường & Lớp để thêm phòng trước khi khai báo danh mục." />
    );
  }
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (items === null) return <PageLoading />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button className="btn-primary !py-2" onClick={() => setEditing({})}>+ Thêm thiết bị</button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🧰" title="Phòng chưa có danh mục thiết bị"
          hint="Khai báo danh mục chuẩn để giáo viên kiểm kê nhanh theo số lượng."
          action={<button className="btn-primary" onClick={() => setEditing({})}>+ Thêm thiết bị</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="th">Tên thiết bị</th>
                  <th className="th">SKU</th>
                  <th className="th">Đơn vị</th>
                  <th className="th">SL chuẩn</th>
                  <th className="th">Sắp xếp</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="td font-semibold">{it.name}</td>
                    <td className="td text-ink-muted">{it.sku || '—'}</td>
                    <td className="td">{it.unit || '—'}</td>
                    <td className="td">{it.expected_qty ?? '—'}</td>
                    <td className="td text-ink-muted">{it.sort_order ?? 0}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-ghost !px-2.5 !py-1 text-[13px]" onClick={() => setEditing(it)}>✏️ Sửa</button>
                      <button className="btn-ghost !px-2.5 !py-1 text-[13px] !text-rose-600" onClick={() => setDeleting(it)}>🗑 Xoá</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CatalogFormSheet
        open={editing !== null}
        item={editing}
        roomId={roomId}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load(); }}
      />

      <ConfirmSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Xoá thiết bị"
        message={`Xoá "${deleting?.name || ''}" khỏi danh mục phòng? Các lần kiểm kê trước đây vẫn được giữ nguyên.`}
        danger
        confirmLabel="Xoá"
        busy={deleteBusy}
      />
    </div>
  );
}

/* --------------------------- Form thêm/sửa danh mục ------------------------- */

function CatalogFormSheet({ open, item, roomId, onClose, onDone }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [expectedQty, setExpectedQty] = useState('1');
  const [sortOrder, setSortOrder] = useState('0');
  const [busy, setBusy] = useState(false);

  const isEdit = !!item?.id;

  useEffect(() => {
    if (!open) return;
    setName(item?.name || '');
    setSku(item?.sku || '');
    setUnit(item?.unit || '');
    setExpectedQty(String(item?.expected_qty ?? 1));
    setSortOrder(String(item?.sort_order ?? 0));
  }, [open, item]);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) { toast.err('Vui lòng nhập tên thiết bị.'); return; }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        sku: sku.trim(),
        unit: unit.trim(),
        expected_qty: Math.max(0, Number(expectedQty) || 0),
        sort_order: Number(sortOrder) || 0,
      };
      if (isEdit) {
        await api.patch(`/api/devices/catalog/${item.id}`, body);
        toast.ok('Đã cập nhật thiết bị.');
      } else {
        await api.post('/api/devices/catalog', { ...body, room_id: roomId });
        toast.ok('Đã thêm thiết bị vào danh mục.');
      }
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={isEdit ? 'Sửa thiết bị' : 'Thêm thiết bị'}>
      <Field label="Tên thiết bị" required>
        <input className="input" placeholder="VD: Robot UGOT, bộ Stick'em cơ bản…"
          value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="SKU / mã">
          <input className="input" placeholder="VD: UGOT-01"
            value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Đơn vị">
          <input className="input" placeholder="VD: bộ, chiếc"
            value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Số lượng chuẩn" required hint="Số lượng đúng phải có trong phòng.">
          <input className="input" type="number" min="0" inputMode="numeric"
            value={expectedQty} onChange={(e) => setExpectedQty(e.target.value)} />
        </Field>
        <Field label="Thứ tự sắp xếp" hint="Số nhỏ hiện trước.">
          <input className="input" type="number" inputMode="numeric"
            value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>

      <div className="flex gap-2.5 justify-end mt-1">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner className="!h-4 !w-4 border-white/40 border-t-white" /> : (isEdit ? 'Lưu thay đổi' : 'Thêm thiết bị')}
        </button>
      </div>
    </Sheet>
  );
}

/* ================================ MÀN HÌNH CHÍNH ============================ */

export default function DevicesHome() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('check');

  const [schools, setSchools] = useState(null);
  const [schoolsErr, setSchoolsErr] = useState(null);
  const [schoolId, setSchoolId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [roomsLoading, setRoomsLoading] = useState(false);

  const loadSchools = useCallback(async () => {
    setSchoolsErr(null);
    setSchools(null);
    try {
      const list = unwrap(await api.get('/api/schools', { limit: 200 }));
      setSchools(list);
      setSchoolId((cur) => (cur && list.some((s) => String(s.id) === String(cur)) ? cur : String(list[0]?.id ?? '')));
    } catch (e) { setSchoolsErr(e); }
  }, []);

  useEffect(() => { loadSchools(); }, [loadSchools]);

  // Nạp phòng khi đổi trường; tự chọn phòng đầu tiên.
  useEffect(() => {
    if (!schoolId) { setRooms([]); setRoomId(''); return undefined; }
    let alive = true;
    setRoomsLoading(true);
    api.get('/api/rooms', { school_id: schoolId, limit: 200 })
      .then((res) => {
        if (!alive) return;
        const list = unwrap(res);
        setRooms(list);
        setRoomId((cur) => (cur && list.some((r) => String(r.id) === String(cur)) ? cur : String(list[0]?.id ?? '')));
      })
      .catch((e) => { if (alive) { setRooms([]); setRoomId(''); toast.fromError(e); } })
      .finally(() => { if (alive) setRoomsLoading(false); });
    return () => { alive = false; };
  }, [schoolId, toast]);

  const tabs = [
    { value: 'check', label: 'Kiểm kê' },
    { value: 'issues', label: 'Báo hỏng' },
    ...(auth.can('device.catalog') ? [{ value: 'catalog', label: 'Danh mục' }] : []),
  ];

  return (
    <div>
      <PageHeader title="Thiết bị" sub="Kiểm kê theo mốc trong ngày, báo hỏng và danh mục từng phòng." />
      <Segmented options={tabs} value={tab} onChange={setTab} className="mb-4" />

      {schoolsErr && <ErrorBox error={schoolsErr} onRetry={loadSchools} />}
      {!schoolsErr && schools === null && <PageLoading />}

      {schools !== null && !schoolsErr && (
        <>
          {tab !== 'issues' && (
            schools.length === 0 ? (
              <EmptyState icon="🏫" title="Chưa có trường trong phạm vi của bạn"
                hint="Liên hệ Quản trị viên để được gán trường phụ trách." />
            ) : (
              <SchoolRoomPicker
                schools={schools} schoolId={schoolId} onSchool={setSchoolId}
                rooms={rooms} roomId={roomId} onRoom={setRoomId}
                loading={roomsLoading} />
            )
          )}

          {tab === 'check' && schools.length > 0 && (
            <CheckTab schoolId={schoolId} roomId={roomId}
              roomsLoading={roomsLoading} hasRooms={rooms.length > 0} />
          )}

          {tab === 'issues' && (
            <IssuesTab schools={schools} defaultSchoolId={schoolId} />
          )}

          {tab === 'catalog' && auth.can('device.catalog') && schools.length > 0 && (
            <CatalogTab roomId={roomId} roomsLoading={roomsLoading} hasRooms={rooms.length > 0} />
          )}
        </>
      )}
    </div>
  );
}
