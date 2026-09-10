/**
 * FeedbackHome.jsx — Danh sách góp ý (giáo trình / thiết bị / khác) + gửi góp ý mới.
 *
 * - Segmented trạng thái Mới / Đang xử lý / Đã xong / Tất cả + lọc phân loại.
 * - Thẻ góp ý → /gop-y/:id.
 * - Mọi vai trò đều gửi được góp ý (multipart, kèm tối đa 3 ảnh).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtAgo } from '../../lib/format.js';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading, Pager,
  Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';

const STATUS_OPTIONS = [
  { value: 'new', label: 'Mới' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'resolved', label: 'Đã xong' },
  { value: '', label: 'Tất cả' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'Tất cả phân loại' },
  ...Object.entries(LABEL.category).map(([value, label]) => ({ value, label })),
];

const LIMIT = 20;
const EMPTY_FORM = { category: '', title: '', body: '', school_id: '', class_id: '', room_id: '', priority: 'normal' };

/* ------------------------------- Thẻ góp ý -------------------------------- */
function FeedbackCard({ f }) {
  const school = f.school_name || f.school?.name;
  const klass = f.class_name || f.class?.name;
  const sender = f.created_by_name || f.creator_name || f.creator?.full_name || f.user?.full_name;
  return (
    <Link to={`/gop-y/${f.id}`} className="card block p-4 hover:border-brand-300 transition">
      <div className="flex items-start justify-between gap-2.5">
        <div className="font-bold text-[14.5px] leading-snug min-w-0">{f.title}</div>
        <Badge tone={f.status} className="shrink-0">{LABEL.issue[f.status] || f.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <Badge tone="neutral">{LABEL.category[f.category] || f.category || 'Khác'}</Badge>
        {f.priority && <Badge tone={f.priority}>{LABEL.priority[f.priority] || f.priority}</Badge>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ink-muted mt-2.5">
        {school && <span>🏫 {school}{klass ? ` · ${klass}` : ''}</span>}
        {sender && <span>👤 {sender}</span>}
        <span>💬 {f.reply_count ?? 0} trả lời</span>
        <span>🕐 {fmtAgo(f.created_at)}</span>
      </div>
    </Link>
  );
}

export default function FeedbackHome() {
  const auth = useAuth();
  const toast = useToast();

  /* ------------------------------- Danh sách -------------------------------- */
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);        // { items, total }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.get('/api/feedback', { status, category, page, limit: LIMIT });
      const items = Array.isArray(res) ? res : res?.items || [];
      const total = Array.isArray(res) ? res.length : res?.total ?? items.length;
      setData({ items, total });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [status, category, page]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = (v) => { setStatus(v); setPage(1); };
  const changeCategory = (v) => { setCategory(v); setPage(1); };

  /* ----------------------------- Form gửi góp ý ------------------------------ */
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [photos, setPhotos] = useState([]);
  const [sending, setSending] = useState(false);
  const [schools, setSchools] = useState(auth.schools || []);
  const [classes, setClasses] = useState([]);
  const [rooms, setRooms] = useState([]);

  const setVal = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const changeSchool = (v) => setForm((f) => ({ ...f, school_id: v, class_id: '', room_id: '' }));

  // Danh sách trường: ưu tiên phạm vi trong hồ sơ; thiếu thì hỏi server (đã lọc theo vai trò).
  useEffect(() => {
    if (!open || schools.length) return;
    api.get('/api/schools')
      .then((d) => setSchools(Array.isArray(d) ? d : d?.items || []))
      .catch((e) => toast.fromError(e));
  }, [open, schools.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lớp & phòng theo trường đã chọn (không bắt buộc).
  useEffect(() => {
    if (!form.school_id) { setClasses([]); setRooms([]); return undefined; }
    let alive = true;
    api.get('/api/classes', { school_id: form.school_id })
      .then((d) => { if (alive) setClasses(Array.isArray(d) ? d : d?.items || []); })
      .catch(() => { if (alive) setClasses([]); });
    api.get('/api/rooms', { school_id: form.school_id })
      .then((d) => { if (alive) setRooms(Array.isArray(d) ? d : d?.items || []); })
      .catch(() => { if (alive) setRooms([]); });
    return () => { alive = false; };
  }, [form.school_id]);

  const submit = async () => {
    if (!form.category) { toast.err('Vui lòng chọn phân loại góp ý.'); return; }
    if (!form.title.trim()) { toast.err('Vui lòng nhập tiêu đề.'); return; }
    if (!form.body.trim()) { toast.err('Vui lòng nhập nội dung góp ý.'); return; }
    if (!form.school_id) { toast.err('Vui lòng chọn trường.'); return; }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('category', form.category);
      fd.append('title', form.title.trim());
      fd.append('body', form.body.trim());
      fd.append('school_id', form.school_id);
      if (form.class_id) fd.append('class_id', form.class_id);
      if (form.room_id) fd.append('room_id', form.room_id);
      fd.append('priority', form.priority);
      photos.forEach((p) => fd.append('photos', p.blob, p.name));
      await api.upload('/api/feedback', fd);
      toast.ok('Đã gửi góp ý tới Phòng chuyên môn.');
      setOpen(false);
      setForm(EMPTY_FORM);
      setPhotos([]);
      if (page !== 1) setPage(1);
      else await load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSending(false);
    }
  };

  /* ---------------------------------- Render --------------------------------- */
  if (loading && data === null) return <PageLoading />;

  return (
    <div>
      <PageHeader
        title="Góp ý & phản hồi"
        sub="Phản ánh về giáo trình, thiết bị và các vấn đề khác tại trường."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>+ Gửi góp ý</button>
        }
      />

      <div className="flex flex-col items-start gap-2 mb-4">
        <Segmented options={STATUS_OPTIONS} value={status} onChange={changeStatus} />
        <Segmented options={CATEGORY_OPTIONS} value={category} onChange={changeCategory} />
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      {!error && data && data.items.length === 0 && (
        <EmptyState
          icon="📨"
          title="Chưa có góp ý nào"
          hint={status || category
            ? 'Không có góp ý nào khớp bộ lọc hiện tại. Hãy thử chọn trạng thái hoặc phân loại khác.'
            : 'Gặp vấn đề về giáo trình, thiết bị? Hãy gửi góp ý để Phòng chuyên môn xử lý.'}
          action={
            <button className="btn-primary" onClick={() => setOpen(true)}>+ Gửi góp ý</button>
          }
        />
      )}

      {!error && data && data.items.length > 0 && (
        <>
          <div className={`grid gap-3 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            {data.items.map((f) => <FeedbackCard key={f.id} f={f} />)}
          </div>
          <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />
        </>
      )}

      {/* ----------------------------- Sheet gửi góp ý --------------------------- */}
      <Sheet open={open} onClose={sending ? undefined : () => setOpen(false)} title="Gửi góp ý mới">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label="Phân loại" required>
            <select className="input" value={form.category} onChange={(e) => setVal('category', e.target.value)}>
              <option value="">— Chọn phân loại —</option>
              {Object.entries(LABEL.category).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Tiêu đề" required>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setVal('title', e.target.value)}
              placeholder="Tóm tắt ngắn gọn vấn đề"
            />
          </Field>
          <Field label="Nội dung" required>
            <textarea
              className="input"
              rows={4}
              value={form.body}
              onChange={(e) => setVal('body', e.target.value)}
              placeholder="Mô tả chi tiết vấn đề: xảy ra ở đâu, khi nào, ảnh hưởng thế nào…"
            />
          </Field>
          <Field label="Trường" required>
            <select className="input" value={form.school_id} onChange={(e) => changeSchool(e.target.value)}>
              <option value="">— Chọn trường —</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lớp">
              <select
                className="input"
                value={form.class_id}
                onChange={(e) => setVal('class_id', e.target.value)}
                disabled={!classes.length}>
                <option value="">— Không chọn —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Phòng">
              <select
                className="input"
                value={form.room_id}
                onChange={(e) => setVal('room_id', e.target.value)}
                disabled={!rooms.length}>
                <option value="">— Không chọn —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Mức ưu tiên">
            <select className="input" value={form.priority} onChange={(e) => setVal('priority', e.target.value)}>
              {Object.entries(LABEL.priority).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <PhotoInput
            value={photos}
            onChange={setPhotos}
            max={3}
            label="Ảnh minh hoạ"
            hint="Tối đa 3 ảnh — chụp rõ vấn đề cần phản ánh."
          />
          <div className="flex justify-end gap-2.5 mt-2">
            <button type="button" className="btn-line" onClick={() => setOpen(false)} disabled={sending}>Huỷ</button>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Gửi góp ý'}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
