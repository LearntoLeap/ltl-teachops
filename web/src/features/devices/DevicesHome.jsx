/**
 * DevicesHome.jsx — Màn hình Thiết bị, 2 tab:
 *   - Báo hỏng: báo hỏng đột xuất hoặc đề nghị bổ sung (mua thêm), một lần báo
 *     được nhiều thiết bị; xử lý phiếu và xuất Excel.
 *   - Danh mục: danh mục thiết bị chuẩn của từng phòng (admin/Phòng chuyên môn).
 *
 * KHÔNG có phần kiểm kê ở đây: đếm thiết bị đầu/cuối buổi là một bước của CHẤM
 * CÔNG — thiếu hoặc hỏng lúc check-out tự mở phiếu báo hỏng ở tab Báo hỏng.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtAgo } from '../../lib/format.js';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Pager, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';

/* ------------------------------ Tiện ích chung ----------------------------- */

/** Danh sách từ server có thể là mảng trần hoặc bọc {items, total}. */
const unwrap = (res) => (Array.isArray(res) ? res : res?.items || []);

/** Lấy danh sách id ảnh của bản ghi, chấp nhận nhiều dạng dữ liệu server trả. */
function photoIds(rec) {
  const arr = rec?.photos || rec?.photo_ids || rec?.files || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => (p && typeof p === 'object' ? p.file_id || p.id : p)).filter(Boolean);
}

/** Tên người báo phiếu. */
function personName(rec) {
  return rec?.checked_by_name || rec?.reported_by_name || rec?.created_by_name
    || rec?.checker?.full_name || rec?.reporter?.full_name || rec?.user?.full_name
    || rec?.created_by?.full_name || '—';
}

/** Dải ảnh thu nhỏ — bấm mở bản đầy đủ ở tab mới. */
function PhotoStrip({ rec, size = 'h-9 w-9' }) {
  const ids = photoIds(rec);
  if (!ids.length) return <span className="text-ink-muted text-xs">—</span>;
  return (
    <div className="flex gap-1.5 items-center">
      {ids.slice(0, 4).map((id) => (
        <a key={id} href={fileUrl(id)} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={fileUrl(id, { thumb: true })} alt="Ảnh minh chứng"
            className={`${size} rounded-lg object-cover border border-line`} />
        </a>
      ))}
      {ids.length > 4 && <span className="text-xs text-ink-muted">+{ids.length - 4}</span>}
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
  const [kind, setKind] = useState('');        // '' = cả báo hỏng lẫn đề nghị bổ sung
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);       // {items, total}
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/devices/issues', { status, kind, page, limit });
      const items = unwrap(res);
      setData({ items, total: res?.total ?? items.length });
    } catch (e) { setError(e); }
  }, [status, kind, page]);

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
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={ISSUE_FILTERS} value={status}
            onChange={(v) => { setStatus(v); setPage(1); }} />
          <select className="input !w-auto !py-2" value={kind} aria-label="Lọc theo loại phiếu"
            onChange={(e) => { setKind(e.target.value); setPage(1); }}>
            <option value="">Mọi loại phiếu</option>
            <option value="broken">🛠 Báo hỏng</option>
            <option value="restock">🛒 Cần mua thêm</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {auth.can('export.scope') && (
            <button className="btn-line !py-2" onClick={exportXlsx} disabled={exporting}>
              {exporting ? <Spinner className="!h-4 !w-4" /> : '⬇️'} Xuất Excel
            </button>
          )}
          <button className="btn-primary !py-2" onClick={() => setFormOpen(true)}>+ Báo hỏng / đề nghị</button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && data === null && <PageLoading />}

      {data !== null && !error && (
        data.items.length === 0 ? (
          <EmptyState icon="🛠️" title="Không có phiếu nào"
            hint={status || kind
              ? 'Thử chuyển bộ lọc sang "Tất cả" / "Mọi loại phiếu" để xem toàn bộ.'
              : 'Thiết bị hỏng hoặc thiếu so với nhu cầu? Hãy báo ngay để được xử lý.'}
            action={<button className="btn-primary" onClick={() => setFormOpen(true)}>+ Báo hỏng / đề nghị</button>} />
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

/** Số lượng trên phiếu — server trả `quantity`, bản ghi cũ có thể là `qty`. */
const qtyOf = (issue) => Number(issue?.quantity ?? issue?.qty ?? 1) || 1;

function IssueCard({ issue, canResolve, onChangeStatus }) {
  const name = issue.device_name || issue.catalog_name || issue.catalog?.name || issue.name || 'Thiết bị';
  const place = [issue.school_name || issue.school?.name, issue.room_name || issue.room?.name]
    .filter(Boolean).join(' · ');
  return (
    <div className="card p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 font-semibold text-base text-ink">
          {name}
          {qtyOf(issue) > 1 && <span className="text-ink-muted font-normal"> × {qtyOf(issue)}</span>}
        </div>
        {issue.kind === 'restock' && <Badge tone="pending">🛒 Cần mua thêm</Badge>}
        <Badge tone={issue.priority}>{LABEL.priority[issue.priority] || issue.priority}</Badge>
        <Badge tone={issue.status}>{LABEL.issue[issue.status] || issue.status}</Badge>
      </div>

      {issue.description && <p className="text-sm text-ink-soft mt-1.5">{issue.description}</p>}

      {photoIds(issue).length > 0 && (
        <div className="mt-2.5"><PhotoStrip rec={issue} size="h-14 w-14" /></div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted mt-2.5">
        {place && <span>🏫 {place}</span>}
        <span>👤 {personName(issue)}</span>
        <span>🕒 {fmtAgo(issue.created_at)}</span>
      </div>

      {issue.status === 'resolved' && issue.resolution && (
        <div className="mt-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
          ✓ Khắc phục: {issue.resolution}
        </div>
      )}

      {canResolve && (
        <div className="mt-3">
          <button className="btn-line !py-1.5 text-sm" onClick={onChangeStatus}>🔧 Đổi trạng thái</button>
        </div>
      )}
    </div>
  );
}

/* ------------------- Form báo hỏng / đề nghị bổ sung ----------------------- */

/** Hai việc của mục Thiết bị — khớp device_issues.kind ở máy chủ. */
const KIND_OPTS = [
  { value: 'broken', label: '🛠 Báo hỏng' },
  { value: 'restock', label: '🛒 Cần mua thêm' },
];

/** Một dòng thiết bị trong phiếu. key chỉ để React nhận diện dòng. */
let lineSeq = 0;
const emptyLine = () => ({ key: `l${(lineSeq += 1)}`, catalog_id: '', device_name: '', quantity: '1' });

function IssueFormSheet({ open, onClose, onDone, schools, defaultSchoolId }) {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [kind, setKind] = useState('broken');
  const [lines, setLines] = useState([emptyLine()]);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);

  const restock = kind === 'restock';

  // Reset form mỗi lần mở.
  useEffect(() => {
    if (!open) return;
    setSchoolId(String(defaultSchoolId || schools[0]?.id || ''));
    setKind('broken');
    setLines([emptyLine()]);
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

  // Danh mục theo phòng đã chọn; đổi phòng thì bỏ thiết bị đã chọn theo danh mục cũ.
  useEffect(() => {
    setLines((ls) => ls.map((l) => (l.catalog_id ? { ...l, catalog_id: '' } : l)));
    if (!open || !roomId) { setCatalog([]); return undefined; }
    let alive = true;
    api.get('/api/devices/catalog', { room_id: roomId, limit: 200 })
      .then((res) => { if (alive) setCatalog(unwrap(res)); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, [open, roomId]);

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const dropLine = (key) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  const nameOfCatalog = (id) => catalog.find((c) => String(c.id) === String(id))?.name || '';

  const submit = async () => {
    if (busy) return;
    if (!schoolId) { toast.err('Vui lòng chọn trường.'); return; }

    const items = lines
      .map((l) => ({
        catalog_id: l.catalog_id || undefined,
        device_name: l.catalog_id ? nameOfCatalog(l.catalog_id) : l.device_name.trim(),
        quantity: Math.max(1, Number(l.quantity) || 1),
      }))
      .filter((it) => it.catalog_id || it.device_name);

    if (!items.length) { toast.err('Vui lòng chọn thiết bị trong danh mục hoặc nhập tên thiết bị.'); return; }
    if (!description.trim()) {
      toast.err(restock ? 'Vui lòng ghi rõ vì sao cần bổ sung.' : 'Vui lòng mô tả tình trạng hỏng.');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('school_id', String(schoolId));
      if (roomId) fd.append('room_id', String(roomId));
      fd.append('kind', kind);
      fd.append('items', JSON.stringify(items));   // nhiều thiết bị trong một lần báo
      fd.append('description', description.trim());
      fd.append('priority', priority);
      photos.forEach((p) => fd.append('photos', p.blob, p.name));
      const res = await api.upload('/api/devices/issues', fd);
      const n = res?.created ?? items.length;
      toast.ok(restock
        ? `Đã gửi đề nghị bổ sung ${n} thiết bị.`
        : `Đã gửi báo hỏng ${n} thiết bị.`);
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose}
      title={restock ? 'Đề nghị bổ sung thiết bị' : 'Báo hỏng thiết bị'} wide>
      <Field label="Việc cần báo" required>
        <Segmented options={KIND_OPTS} value={kind} onChange={setKind} />
      </Field>
      <p className="text-xs text-ink-muted -mt-2 mb-3.5">
        {restock
          ? 'Dùng khi thiết bị còn tốt nhưng thiếu so với nhu cầu dạy — ghi rõ cần thêm bao nhiêu.'
          : 'Thiết bị hỏng, vỡ, mất — báo ngay để Phòng chuyên môn xử lý. Báo được nhiều thiết bị một lần.'}
      </p>

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

      <Field label="Thiết bị" required
        hint={catalog.length
          ? 'Chọn trong danh mục của phòng, hoặc để "Nhập tay" rồi gõ tên.'
          : 'Phòng chưa có danh mục — gõ thẳng tên thiết bị.'}>
        <div className="grid gap-2">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-xl border border-line p-2.5 grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink-muted w-6 shrink-0">{i + 1}.</span>
                <select className="input !py-2 flex-1" value={l.catalog_id}
                  disabled={!catalog.length}
                  onChange={(e) => setLine(l.key, { catalog_id: e.target.value })}>
                  <option value="">— Nhập tay tên thiết bị —</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input className="input !py-2 !w-20 shrink-0" type="number" min="1" inputMode="numeric"
                  aria-label={`Số lượng dòng ${i + 1}`}
                  value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                {lines.length > 1 && (
                  <button type="button" className="icon-btn shrink-0" aria-label={`Bỏ dòng ${i + 1}`}
                    onClick={() => dropLine(l.key)}>✕</button>
                )}
              </div>
              {!l.catalog_id && (
                <input className="input !py-2" placeholder="VD: Robot UGOT số 3, máy chiếu…"
                  aria-label={`Tên thiết bị dòng ${i + 1}`}
                  value={l.device_name} onChange={(e) => setLine(l.key, { device_name: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      </Field>
      <button type="button" className="btn-ghost !py-1.5 text-sm -mt-2 mb-3.5" onClick={addLine}>
        + Thêm thiết bị
      </button>

      <Field label="Mức ưu tiên">
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {Object.entries(LABEL.priority).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>

      <Field label={restock ? 'Vì sao cần bổ sung' : 'Mô tả tình trạng'} required>
        <textarea className="input" rows={3}
          placeholder={restock
            ? 'VD: lớp 32 HS mà chỉ có 12 bộ, mỗi nhóm 3 em phải chờ nhau…'
            : 'Hỏng thế nào, ảnh hưởng gì tới buổi dạy…'}
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <PhotoInput value={photos} onChange={setPhotos}
        label={restock ? 'Ảnh / video minh hoạ (nếu có)' : 'Ảnh / video thiết bị hỏng'} allowVideo
        hint={restock
          ? 'Ảnh khu vực thiết bị giúp Phòng chuyên môn hình dung nhu cầu thực tế.'
          : 'Chụp rõ vị trí hỏng; quay video nếu lỗi chỉ thấy khi thiết bị chạy.'} />

      <div className="form-actions flex gap-2.5 justify-end mt-1">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner className="!h-4 !w-4 border-white/40 border-t-white" />
            : (restock ? 'Gửi đề nghị' : 'Gửi báo hỏng')}
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
          <div className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3.5 text-sm">
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

          <div className="form-actions flex gap-2.5 justify-end mt-1">
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

function CatalogTab({ schoolId, roomId, roomsLoading, hasRooms }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [suggestOpen, setSuggestOpen] = useState(false);   // sheet chọn từ danh mục đề xuất
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
      <div className="flex justify-end gap-2 mb-3">
        <button className="btn-line !py-2" onClick={() => setSuggestOpen(true)}>
          📋 Chọn từ danh mục đề xuất
        </button>
        <button className="btn-primary !py-2" onClick={() => setEditing({})}>+ Thêm thiết bị</button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🧰" title="Phòng chưa có danh mục thiết bị"
          hint="Khai báo danh mục chuẩn để giáo viên kiểm kê nhanh theo số lượng."
          action={<button className="btn-primary" onClick={() => setEditing({})}>+ Thêm thiết bị</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto table-cards stagger">
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
                    <td data-label="Tên thiết bị" className="td font-semibold">{it.name}</td>
                    <td data-label="SKU" className="td text-ink-muted">{it.sku || '—'}</td>
                    <td data-label="Đơn vị" className="td">{it.unit || '—'}</td>
                    <td data-label="SL chuẩn" className="td">{it.expected_qty ?? '—'}</td>
                    <td data-label="Sắp xếp" className="td text-ink-muted">{it.sort_order ?? 0}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-ghost !px-2.5 !py-1 text-sm" onClick={() => setEditing(it)}>✏️ Sửa</button>
                      <button className="btn-ghost !px-2.5 !py-1 text-sm !text-rose-600" onClick={() => setDeleting(it)}>🗑 Xoá</button>
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

      <SuggestionSheet
        open={suggestOpen}
        schoolId={schoolId}
        roomId={roomId}
        existing={items || []}
        onClose={() => setSuggestOpen(false)}
        onDone={() => { setSuggestOpen(false); load(); }}
      />
    </div>
  );
}

/* ------------------- Sheet: chọn thiết bị từ danh mục đề xuất ----------------- */
/**
 * Hiện danh mục đề xuất theo nhóm (Robotics / Máy tính / Nghe nhìn / Khác).
 * Mỗi dòng: bật/tắt + ô nhập SỐ LƯỢNG riêng (uKIT bao nhiêu, UGOT bao nhiêu,
 * laptop/tablet/loa/mic bao nhiêu…). Thiết bị đã có trong phòng hiện sẵn số
 * lượng hiện tại và sẽ được CẬP NHẬT thay vì tạo trùng.
 * Admin còn thêm được mục gợi ý mới cho toàn hệ thống.
 */
const CAT_LABEL = {
  robotics: '🤖 Robotics & bộ kit',
  computer: '💻 Máy tính & thiết bị học tập',
  av: '🔊 Nghe nhìn',
  other: '📦 Khác',
};

function SuggestionSheet({ open, schoolId, roomId, existing, onClose, onDone }) {
  const auth = useAuth();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState({});          // name -> qty (chuỗi)
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('other');
  const [newUnit, setNewUnit] = useState('chiếc');

  const loadList = useCallback(() => {
    api.get('/api/devices/suggestions')
      .then((d) => setList(d?.items || []))
      .catch(() => setList([]));
  }, []);

  useEffect(() => { if (open && list === null) loadList(); }, [open, list, loadList]);

  // Mở sheet: tick sẵn những thiết bị phòng đã có, kèm số lượng hiện tại.
  useEffect(() => {
    if (!open) return;
    const cur = {};
    for (const it of existing || []) cur[String(it.name).toLowerCase()] = String(it.expected_qty ?? 0);
    setPicked(cur);
  }, [open, existing]);

  const keyOf = (sg) => String(sg.name).toLowerCase();
  const isOn = (sg) => picked[keyOf(sg)] !== undefined;

  const toggle = (sg) => setPicked((p) => {
    const k = keyOf(sg);
    const next = { ...p };
    if (k in next) delete next[k];
    else next[k] = String(sg.default_qty ?? 1);
    return next;
  });

  const setQty = (sg, v) => setPicked((p) => ({ ...p, [keyOf(sg)]: v }));

  const addSuggestion = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const sg = await api.post('/api/devices/suggestions', {
        name, category: newCat, unit: newUnit.trim() || 'chiếc',
      });
      toast.ok(`Đã thêm "${sg.name}" vào danh mục đề xuất.`);
      setNewName(''); setAdding(false);
      loadList();
      setPicked((p) => ({ ...p, [name.toLowerCase()]: String(sg.default_qty ?? 1) }));
    } catch (e) { toast.fromError(e); }
  };

  const submit = async () => {
    const chosen = (list || []).filter(isOn);
    if (!chosen.length) { toast.err('Chưa chọn thiết bị nào.'); return; }
    setBusy(true);
    try {
      const res = await api.post('/api/devices/catalog/bulk', {
        // Trường đang chọn ở đầu màn; danh mục rỗng thì existing không có gì để suy ra.
        school_id: schoolId || (existing[0] || {}).school_id || undefined,
        room_id: roomId,
        items: chosen.map((sg, i) => ({
          name: sg.name,
          unit: sg.unit,
          expected_qty: Number(picked[keyOf(sg)] || 0),
          sort_order: sg.sort_order || (i + 1) * 10,
        })),
      });
      toast.ok(`Đã thêm ${res.created} · cập nhật ${res.updated} thiết bị.`);
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const groups = ['robotics', 'computer', 'av', 'other']
    .map((c) => [c, (list || []).filter((x) => x.category === c)])
    .filter(([, arr]) => arr.length);

  const count = Object.keys(picked).length;

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide title="Danh mục thiết bị đề xuất">
      {list === null ? (
        <PageLoading label="Đang tải danh mục đề xuất…" />
      ) : (
        <>
          <div className="text-sm text-ink-muted mb-3">
            Bật thiết bị có trong phòng rồi nhập số lượng thực tế. Thiết bị phòng đã khai báo
            được tick sẵn — sửa số là cập nhật lại.
          </div>

          {groups.map(([cat, arr]) => (
            <div key={cat} className="mb-3">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-1.5">
                {CAT_LABEL[cat]}
              </div>
              <div className="grid gap-1.5">
                {arr.map((sg) => {
                  const on = isOn(sg);
                  return (
                    <div key={sg.id}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition
                        ${on ? 'border-brand-300 bg-brand-50/50' : 'border-line'}`}>
                      <button type="button" onClick={() => toggle(sg)}
                        className={`h-5 w-5 rounded-md grid place-items-center text-xs font-bold shrink-0 transition
                          ${on ? 'bg-brand-grad text-white' : 'bg-white ring-1 ring-inset ring-line'}`}
                        aria-label={on ? 'Bỏ chọn' : 'Chọn'}>
                        {on ? '✓' : ''}
                      </button>
                      <span className="text-lg w-6 text-center shrink-0">{sg.icon}</span>
                      <button type="button" onClick={() => toggle(sg)}
                        className="flex-1 min-w-0 text-left text-sm font-semibold truncate">
                        {sg.name}
                      </button>
                      {on ? (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number" min="0" inputMode="numeric"
                            className="input !w-20 !py-1.5 text-center font-bold"
                            value={picked[keyOf(sg)]}
                            onChange={(e) => setQty(sg, e.target.value)} />
                          <span className="text-xs text-ink-muted w-10">{sg.unit}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted shrink-0 w-[122px] text-right">
                          gợi ý {sg.default_qty} {sg.unit}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {auth.isAdmin && (
            adding ? (
              <div className="rounded-xl border border-dashed border-brand-300 p-3 mb-3 grid gap-2">
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Tên thiết bị mới, ví dụ: Máy tính bảng Android" autoFocus />
                <div className="flex gap-2">
                  <select className="input flex-1" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                    {Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input className="input !w-28" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}
                    placeholder="đơn vị" />
                  <button type="button" className="btn-primary !px-3" onClick={addSuggestion}>Thêm</button>
                  <button type="button" className="btn-line !px-3" onClick={() => setAdding(false)}>Huỷ</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-line w-full mb-3" onClick={() => setAdding(true)}>
                + Thêm thiết bị vào danh mục đề xuất
              </button>
            )
          )}

          <div className="flex gap-2.5 justify-end items-center mt-2">
            <span className="text-sm text-ink-muted mr-auto">Đã chọn <b>{count}</b> thiết bị</span>
            <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || !count}>
              {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu danh mục'}
            </button>
          </div>
        </>
      )}
    </Sheet>
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

      <div className="form-actions flex gap-2.5 justify-end mt-1">
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
  const [tab, setTab] = useState('issues');

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
    { value: 'issues', label: 'Báo hỏng' },
    ...(auth.can('device.catalog') ? [{ value: 'catalog', label: 'Danh mục' }] : []),
  ];

  return (
    <div>
      <PageHeader title="Thiết bị"
        sub="Báo hỏng đột xuất, đề nghị bổ sung và danh mục thiết bị của từng phòng. Việc đếm thiết bị đầu/cuối buổi nằm trong mục Chấm công." />
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

          {tab === 'issues' && (
            <IssuesTab schools={schools} defaultSchoolId={schoolId} />
          )}

          {tab === 'catalog' && auth.can('device.catalog') && schools.length > 0 && (
            <CatalogTab schoolId={schoolId} roomId={roomId} roomsLoading={roomsLoading} hasRooms={rooms.length > 0} />
          )}
        </>
      )}
    </div>
  );
}
