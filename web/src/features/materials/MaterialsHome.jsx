/**
 * MaterialsHome.jsx — Kho học liệu (/hoc-lieu), bản nâng cấp "thư viện giảng dạy":
 *
 * - Lọc theo: khu vực (Phòng chuyên môn / Giáo viên) · KHỐI 1-12 (dải chip chọn nhanh)
 *   · LOẠI tài liệu (giáo án / giáo trình / slide / nghiên cứu / video / mục tự thêm)
 *   · cấp học · tìm kiếm.
 * - Thẻ tài liệu có ẢNH MINH HOẠ, dòng "Tiết – Tên bài – Chương trình học".
 * - Đăng tài liệu: tệp HOẶC nội dung tự do (bài viết), kèm ảnh bìa; admin/manager
 *   thêm loại tài liệu mới ngay trong form.
 * - Đăng hàng loạt dạng bảng (MaterialsBulkUpload) và tải về .zip theo lựa chọn:
 *   tích chọn từng bài, theo bộ lọc, hoặc cả thư mục giải pháp (MaterialsDownload).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtAgo, LABEL } from '../../lib/format.js';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Pager, SearchBox, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import MaterialsBulkUpload from './MaterialsBulkUpload.jsx';
import MaterialsDownload from './MaterialsDownload.jsx';
import { MAX_MATERIAL_MB, materialFileProblem } from '../../lib/limits.js';
import DeleteMaterialSheet from './DeleteMaterialSheet.jsx';
import MaterialPreview from './MaterialPreview.jsx';
import MaterialsLessonView from './MaterialsLessonView.jsx';
import EditMaterialSheet from './EditMaterialSheet.jsx';

const LIMIT = 30;

const LEVEL_OPTIONS = ['primary', 'secondary', 'highschool']
  .map((v) => ({ value: v, label: LABEL.level[v] }));

const AREA_OPTIONS = [
  { value: 'official', label: 'Kho Phòng chuyên môn' },
  { value: 'teacher', label: 'Bài của Giáo viên' },
];

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

const SORT_OPTIONS = [
  { value: 'moi-nhat', label: 'Mới nhất' },
  { value: 'tiet', label: 'Theo tiết dạy (khối → môn → tiết)' },
  { value: 'khoi', label: 'Theo khối rồi tới tiết' },
  { value: 'ten', label: 'Tên tài liệu A → Z' },
  { value: 'loai', label: 'Theo loại tài liệu' },
  { value: 'cu-nhat', label: 'Cũ nhất' },
];

/** Khối 1-5 → Tiểu học · 6-9 → THCS · 10-12 → THPT. */
const levelOfGrade = (g) => (g <= 5 ? 'primary' : g <= 9 ? 'secondary' : 'highschool');

/** Đoán icon theo đuôi tệp của phiên bản mới nhất. */
function fileIcon(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (ext === 'ppt' || ext === 'pptx') return '📊';
  if (ext === 'doc' || ext === 'docx') return '📘';
  if (['mp4', 'mov', 'webm'].includes(ext)) return '🎬';
  return '📄';
}

/** GET /api/solutions trả về dạng cây — làm phẳng để đổ vào <select>. */
function flattenSolutions(nodes, depth = 0, out = []) {
  for (const n of nodes || []) {
    out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name || n.title || ''}` });
    if (n.children?.length) flattenSolutions(n.children, depth + 1, out);
  }
  return out;
}

/** Dải chip chọn nhanh (khối, loại tài liệu). */
function ChipRow({ label, options, value, onChange, trailing }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted shrink-0">{label}</span>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value === value ? '' : o.value)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ring-1 ring-inset
            ${String(o.value) === String(value)
              ? 'bg-brand-grad text-white ring-transparent shadow-card-sm'
              : 'bg-white text-ink-soft ring-line hover:ring-brand-300 hover:text-brand-800'}`}>
          {o.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}

/** Tải nhanh tệp phiên bản mới nhất của một tài liệu. */
function useQuickDownload() {
  const toast = useToast();
  return useCallback(async (m) => {
    const v = m.latest_version;
    if (!v?.file_id) return;
    try {
      await api.download(`/api/files/${v.file_id}`, { download: 1 }, v.file_name || m.title);
    } catch (e) {
      toast.fromError(e);
    }
  }, [toast]);
}

/* ------------------------------ Thẻ tài liệu ------------------------------ */
function MaterialCard({ m, area, checked, onToggle, canManage, canEdit, onPreview, onEdit, onDownload, onDelete }) {
  const ownerName = m.owner_name || m.owner?.full_name || '';
  const at = m.updated_at || m.latest_version?.created_at || m.created_at;
  const lessonLine = [
    m.lesson_no ? `Tiết ${m.lesson_no}` : null,
    m.lesson_title || null,
    m.curriculum || null,
  ].filter(Boolean).join(' — ');

  return (
    <Link
      to={`/hoc-lieu/${m.id}`}
      className={`card overflow-hidden flex hover:border-brand-300 hover:-translate-y-px transition group relative
        ${checked ? '!border-brand-400 ring-1 ring-brand-300' : ''}`}>
      {/* Ô chọn để tải về — nút thay cho checkbox thật vì nằm trong liên kết */}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Chọn ${m.title} để tải về`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(m); }}
        className={`absolute top-2 right-2 h-5 w-5 rounded-md border grid place-items-center text-[12px] font-bold transition
          ${checked ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white/90 border-line text-transparent hover:border-brand-400'}`}>
        ✓
      </button>
      {/* Ảnh minh hoạ / icon tệp */}
      {m.cover_file_id ? (
        <img
          src={fileUrl(m.cover_file_id, { thumb: true })}
          alt=""
          loading="lazy"
          className="w-[86px] sm:w-[96px] shrink-0 object-cover bg-brand-50"
        />
      ) : (
        <div className="w-[86px] sm:w-[96px] shrink-0 grid place-items-center bg-brand-50/70 text-[30px]">
          {m.type_icon || fileIcon(m.latest_version?.file_name)}
        </div>
      )}

      <div className="min-w-0 flex-1 p-3 pr-9">
        <div className="flex items-center gap-1.5 flex-wrap">
          {m.type_name && (
            <span className="rounded-md bg-brand-50 text-brand-800 px-1.5 py-[1px] text-[10.5px] font-bold">
              {m.type_icon} {m.type_name}
            </span>
          )}
          {m.grade && (
            <span className="rounded-md bg-sky-50 text-sky-700 px-1.5 py-[1px] text-[10.5px] font-bold">
              Khối {m.grade}
            </span>
          )}
          {m.solution_name && (
            <span className="rounded-md bg-emerald-50 text-emerald-700 px-1.5 py-[1px] text-[10.5px] font-bold truncate max-w-[160px]">
              🧩 {m.solution_name}
            </span>
          )}
          {m.is_new && <Badge tone="new">Mới</Badge>}
          {area === 'teacher' && m.approval_status && m.approval_status !== 'approved' && (
            <Badge tone={m.approval_status}>{LABEL.approval[m.approval_status] || m.approval_status}</Badge>
          )}
        </div>

        <div className="font-semibold text-[14.5px] text-ink mt-1 truncate group-hover:text-brand-800 transition">
          {m.title}
        </div>
        {lessonLine && (
          <div className="text-[12px] text-brand-700 font-medium mt-0.5 truncate">📖 {lessonLine}</div>
        )}
        <div className="text-[11.5px] text-ink-muted mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {m.subject && <span>{m.subject}</span>}
          {ownerName && <span>{ownerName}</span>}
          {at && <span>{fmtAgo(at)}</span>}
          {Number(m.comment_count) > 0 && <span>💬 {m.comment_count}</span>}
          {!m.latest_version && m.body && <span>✍️ Bài viết</span>}
        </div>

        {/* Thao tác nhanh — nằm trong liên kết nên phải chặn điều hướng */}
        <div className="flex items-center gap-1 mt-1.5"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <button type="button" title="Xem trước" onClick={() => onPreview(m)}
            className="h-7 px-2 rounded-lg text-[12px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100">
            👁 Xem trước
          </button>
          {m.latest_version?.file_id && (
            <button type="button" title="Tải về" onClick={() => onDownload(m)}
              className="h-7 w-7 rounded-lg text-[14px] text-brand-700 hover:bg-brand-50">⬇</button>
          )}
          {canEdit(m) && (
            <button type="button" title="Sửa thông tin" onClick={() => onEdit(m)}
              className="h-7 w-7 rounded-lg text-[13px] text-ink-muted hover:bg-brand-50 hover:text-brand-800">✏️</button>
          )}
          {canManage(m) && (
            <button type="button" title="Xoá tài liệu này"
              onClick={() => onDelete([{ id: m.id, title: m.title }])}
              className="h-7 w-7 rounded-lg text-[13px] text-ink-muted hover:bg-rose-50 hover:text-rose-700">🗑</button>
          )}
        </div>
      </div>
    </Link>
  );
}

/* --------------------------- Bảng danh sách tài liệu ------------------------ */
/**
 * MaterialTable — chế độ xem danh sách: mỗi tài liệu một dòng, thấy được
 * nhiều mục cùng lúc và so sánh nhanh theo khối / tiết / loại.
 */
function MaterialTable({ items, area, selected, onToggle, onTogglePage, canManage, canEdit, onDelete, onPreview, onEdit }) {
  const quickDownload = useQuickDownload();
  const allOnPage = items.length > 0 && items.every((m) => selected.has(m.id));
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px]">
          <thead>
            <tr>
              <th className="th !w-[40px] text-center">
                <input type="checkbox" className="h-4 w-4 accent-[#8A3F97] align-middle"
                  aria-label="Chọn tất cả tài liệu trong trang"
                  checked={allOnPage} onChange={(e) => onTogglePage(items, e.target.checked)} />
              </th>
              <th className="th !w-[52px]">Khối</th>
              <th className="th !w-[64px]">Tiết</th>
              <th className="th">Tên tài liệu</th>
              <th className="th">Tên bài / Chương trình</th>
              <th className="th !w-[130px]">Loại</th>
              <th className="th !w-[150px]">Giải pháp</th>
              <th className="th !w-[130px]">Người đăng</th>
              <th className="th !w-[140px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className={`transition ${selected.has(m.id) ? 'bg-brand-50/70' : 'hover:bg-brand-50/40'}`}>
                <td className="td text-center">
                  <input type="checkbox" className="h-4 w-4 accent-[#8A3F97] align-middle"
                    aria-label={`Chọn ${m.title}`}
                    checked={selected.has(m.id)} onChange={() => onToggle(m)} />
                </td>
                <td className="td text-center font-bold text-sky-700">{m.grade || '—'}</td>
                <td className="td text-center text-ink-soft">{m.lesson_no || '—'}</td>
                <td className="td">
                  <Link to={`/hoc-lieu/${m.id}`}
                    className="font-semibold text-ink hover:text-brand-800 hover:underline">
                    {m.title}
                  </Link>
                  <span className="ml-1.5 inline-flex gap-1 align-middle">
                    {m.is_new && <Badge tone="new">Mới</Badge>}
                    {area === 'teacher' && m.approval_status && m.approval_status !== 'approved' && (
                      <Badge tone={m.approval_status}>
                        {LABEL.approval[m.approval_status] || m.approval_status}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="td text-[13px] text-ink-soft">
                  {m.lesson_title || '—'}
                  {m.curriculum && (
                    <span className="block text-[11.5px] text-ink-muted">{m.curriculum}</span>
                  )}
                </td>
                <td className="td text-[12.5px]">
                  {m.type_name ? `${m.type_icon || ''} ${m.type_name}` : '—'}
                </td>
                <td className="td text-[12.5px] text-emerald-700 truncate">{m.solution_name || '—'}</td>
                <td className="td text-[12.5px] text-ink-muted">
                  {m.owner_name || '—'}
                  {(m.updated_at || m.created_at) && (
                    <span className="block text-[11px]">{fmtAgo(m.updated_at || m.created_at)}</span>
                  )}
                </td>
                <td className="td !px-1 text-center whitespace-nowrap">
                  <button type="button" title="Xem trước"
                    className="h-8 w-8 rounded-lg text-[15px] text-brand-700 hover:bg-brand-50 hover:text-brand-900"
                    onClick={() => onPreview(m)}>👁</button>
                  {canEdit(m) && (
                    <button type="button" title="Sửa thông tin (tiết, tên tài liệu…)"
                      className="h-8 w-8 rounded-lg text-[14px] text-ink-muted hover:bg-brand-50 hover:text-brand-800"
                      onClick={() => onEdit(m)}>✏️</button>
                  )}
                  {m.latest_version?.file_id && (
                    <button type="button" title={`Tải ${m.latest_version.file_name || 'tệp'} về máy`}
                      className="h-8 w-8 rounded-lg text-[17px] text-brand-700 hover:bg-brand-50 hover:text-brand-900"
                      onClick={() => quickDownload(m)}>⬇</button>
                  )}
                  {canManage(m) && (
                    <button type="button" title="Xoá tài liệu này"
                      className="h-8 w-8 rounded-lg text-[15px] text-ink-muted hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => onDelete([{ id: m.id, title: m.title }])}>🗑</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 text-[11.5px] text-ink-muted bg-canvas/60 border-t border-line">
        {items.length} tài liệu — bấm tên để mở chi tiết · 👁 xem trước · ✏️ sửa thông tin · ⬇ tải nhanh
        {canManage() ? ' · 🗑 xoá · tích ô vuông để chọn tải hoặc xoá nhiều bài' : ' · tích ô vuông để chọn tải nhiều bài'}
      </div>
    </div>
  );
}

/* ------------------------ Sheet thêm giải pháp (Admin) ---------------------- */
const SOLUTION_GROUPS = [
  ['ubtech', 'UBTECH'], ['stickem', "Stick'em"], ['weeemake', 'Weeemake'], ['other', 'Khác'],
];

function AddSolutionSheet({ open, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [grp, setGrp] = useState('ubtech');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.err('Vui lòng nhập tên giải pháp.'); return; }
    setBusy(true);
    try {
      const sol = await api.post('/api/solutions', {
        name: name.trim(), grp,
        description: description.trim() || undefined,
      });
      toast.ok(`Đã thêm giải pháp "${sol.name || name.trim()}".`);
      setName(''); setDescription('');
      onCreated(sol);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Thêm giải pháp giảng dạy">
      <form onSubmit={submit}>
        <Field label="Tên giải pháp" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: UBTECH — uGo, VEX IQ…" autoFocus />
        </Field>
        <Field label="Nhóm" required>
          <select className="input" value={grp} onChange={(e) => setGrp(e.target.value)}>
            {SOLUTION_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Mô tả">
          <textarea className="input" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bộ kit, phạm vi cấp học, ghi chú triển khai…" />
        </Field>
        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Thêm giải pháp'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* --------------------------- Sheet đăng tài liệu --------------------------- */
function UploadSheet({ open, onClose, area, defaultLevel, initialSolutionId = '', types, onTypesChanged, onDone }) {
  const auth = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState('');
  const [grade, setGrade] = useState('');
  const [level, setLevel] = useState(defaultLevel || 'primary');
  const [lessonNo, setLessonNo] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [curriculum, setCurriculum] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [solutionId, setSolutionId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [file, setFile] = useState(null);
  const [cover, setCover] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const [solutions, setSolutions] = useState(null);
  const [classes, setClasses] = useState([]);

  // Thêm loại tài liệu ngay trong form (admin/manager).
  const canAddType = auth.can('material.official.write');
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');

  useEffect(() => { if (open) setLevel(defaultLevel || 'primary'); }, [open, defaultLevel]);
  // Mở form từ trong một giải pháp ⇒ tài liệu mới mặc định thuộc giải pháp đó.
  useEffect(() => { if (open && initialSolutionId) setSolutionId(initialSolutionId); }, [open, initialSolutionId]);

  useEffect(() => {
    if (!open || solutions !== null) return;
    api.get('/api/solutions')
      .then((d) => setSolutions(flattenSolutions(Array.isArray(d) ? d : d?.items || [])))
      .catch(() => setSolutions([]));
  }, [open, solutions]);

  useEffect(() => {
    if (!schoolId) { setClasses([]); setClassId(''); return; }
    let alive = true;
    api.get('/api/classes', { school_id: schoolId })
      .then((d) => { if (alive) setClasses(Array.isArray(d) ? d : d?.items || []); })
      .catch(() => { if (alive) setClasses([]); });
    return () => { alive = false; };
  }, [schoolId]);

  const reset = () => {
    setTitle(''); setTypeId(''); setGrade(''); setLessonNo(''); setLessonTitle('');
    setCurriculum(''); setSubject(''); setDescription(''); setBody('');
    setSolutionId(''); setSchoolId(''); setClassId('');
    setFile(null); setCover(null); setFileKey((k) => k + 1);
  };

  const addType = async () => {
    const name = newType.trim();
    if (!name) return;
    try {
      const t = await api.post('/api/materials/types', { name });
      toast.ok(`Đã thêm loại "${t.name}".`);
      setNewType('');
      setAddingType(false);
      setTypeId(t.id);
      onTypesChanged();
    } catch (e) {
      toast.fromError(e);
    }
  };

  /** Chọn tệp: vượt dung lượng ⇒ báo ngay và bỏ chọn, không để gửi rồi mới lỗi. */
  const pickChecked = (e, setter) => {
    const f = e.target.files?.[0] || null;
    const problem = materialFileProblem(f);
    if (problem) {
      toast.err(problem, 8000);
      e.target.value = '';
      setter(null);
      return;
    }
    setter(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) { toast.err('Vui lòng nhập tiêu đề tài liệu.'); return; }
    if (!file && !body.trim()) {
      toast.err('Cần đính kèm tệp HOẶC nhập nội dung bài viết.');
      return;
    }
    const problem = materialFileProblem(file) || materialFileProblem(cover);
    if (problem) { toast.err(problem, 8000); return; }

    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('area', area);
    fd.append('level', level);
    if (typeId) fd.append('type_id', typeId);
    if (grade) fd.append('grade', String(grade));
    if (lessonNo) fd.append('lesson_no', String(lessonNo));
    if (lessonTitle.trim()) fd.append('lesson_title', lessonTitle.trim());
    if (curriculum.trim()) fd.append('curriculum', curriculum.trim());
    if (subject.trim()) fd.append('subject', subject.trim());
    if (description.trim()) fd.append('description', description.trim());
    if (body.trim()) fd.append('body', body.trim());
    if (solutionId) fd.append('solution_id', solutionId);
    if (schoolId) fd.append('school_id', schoolId);
    if (classId) fd.append('class_id', classId);
    if (file) fd.append('file', file, file.name);
    if (cover) fd.append('cover', cover, cover.name);

    setBusy(true);
    try {
      await api.upload('/api/materials', fd);
      toast.ok('Đã đăng tài liệu.');
      reset();
      onDone();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Đăng tài liệu" wide>
      <form onSubmit={submit}>
        <Field label="Tiêu đề" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Slide bài 5 — Lập trình cảm biến UGOT" />
        </Field>

        {/* Loại tài liệu + thêm mục mới */}
        <Field label="Loại tài liệu" hint={canAddType ? 'Thiếu loại phù hợp? Bấm "+ Thêm loại".' : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {(types || []).map((t) => (
              <button key={t.id} type="button"
                onClick={() => setTypeId(typeId === t.id ? '' : t.id)}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset transition
                  ${typeId === t.id
                    ? 'bg-brand-grad text-white ring-transparent'
                    : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
                {t.icon} {t.name}
              </button>
            ))}
            {canAddType && !addingType && (
              <button type="button" className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 ring-dashed hover:bg-brand-50"
                onClick={() => setAddingType(true)}>
                + Thêm loại
              </button>
            )}
          </div>
          {addingType && (
            <div className="flex gap-2 mt-2">
              <input className="input flex-1" value={newType} onChange={(e) => setNewType(e.target.value)}
                placeholder="Tên loại mới, ví dụ: Phiếu bài tập" autoFocus />
              <button type="button" className="btn-primary !px-3" onClick={addType}>Thêm</button>
              <button type="button" className="btn-line !px-3" onClick={() => setAddingType(false)}>Huỷ</button>
            </div>
          )}
        </Field>

        {/* Khối 1-12 (tự suy cấp học) + cấp học */}
        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Khối lớp" hint="Chọn khối sẽ tự đặt cấp học tương ứng.">
            <select className="input" value={grade}
              onChange={(e) => {
                const g = e.target.value;
                setGrade(g);
                if (g) setLevel(levelOfGrade(Number(g)));
              }}>
              <option value="">— Chọn khối 1-12 —</option>
              {GRADES.map((g) => <option key={g} value={g}>Khối {g}</option>)}
            </select>
          </Field>
          <Field label="Cấp học" required>
            <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        {/* Tiết — tên bài — chương trình học */}
        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Field label="Tiết">
            <input className="input" type="number" min="1" max="500" inputMode="numeric"
              value={lessonNo} onChange={(e) => setLessonNo(e.target.value)} placeholder="5" />
          </Field>
          <Field label="Tên bài">
            <input className="input" value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)}
              placeholder="Ví dụ: Lập trình cảm biến siêu âm" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Chương trình học">
            <input className="input" value={curriculum} onChange={(e) => setCurriculum(e.target.value)}
              placeholder="Ví dụ: Robotics UGOT — HK1" />
          </Field>
          <Field label="Môn học">
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Ví dụ: Robotics, Tin học…" />
          </Field>
        </div>

        <Field label="Mô tả ngắn">
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Tóm tắt nội dung, phạm vi sử dụng…" />
        </Field>

        <Field label="Nội dung bài viết" hint="Có thể đăng thuần nội dung mà không cần tệp đính kèm.">
          <textarea className="input min-h-[110px]" value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Soạn nội dung bất kỳ: hướng dẫn, ghi chú chuyên môn, kịch bản dạy…" />
        </Field>

        <Field label="Giải pháp" hint="Gắn tài liệu vào giải pháp/bộ kit tương ứng (nếu có).">
          <select className="input" value={solutionId} onChange={(e) => setSolutionId(e.target.value)}>
            <option value="">— Không gắn giải pháp —</option>
            {(solutions || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>

        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Trường (tuỳ chọn)">
            <select className="input" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">— Dùng chung —</option>
              {(auth.schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Lớp (tuỳ chọn)">
            <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!schoolId}>
              <option value="">— Tất cả các lớp —</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Tệp tài liệu" hint={`PDF, Word, PowerPoint, Excel, video — tối đa ${MAX_MATERIAL_MB} MB.`}>
            <input
              key={`f${fileKey}`}
              type="file"
              className="input !py-2"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.webm,.m4v,.zip"
              onChange={(e) => pickChecked(e, setFile)}
            />
          </Field>
          <Field label="Ảnh minh hoạ" hint="Hiển thị trên thẻ tài liệu ngoài danh sách.">
            <input
              key={`c${fileKey}`}
              type="file"
              className="input !py-2"
              accept="image/*"
              onChange={(e) => pickChecked(e, setCover)}
            />
          </Field>
        </div>

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang tải lên…</> : 'Đăng tài liệu'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* -------------------------------- Màn hình -------------------------------- */
export default function MaterialsHome() {
  const auth = useAuth();
  const [area, setArea] = useState('official');
  const [grade, setGrade] = useState('');
  const [typeId, setTypeId] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [types, setTypes] = useState([]);
  const [solutionId, setSolutionId] = useState('');
  const [solutions, setSolutions] = useState([]);
  const [solutionFormOpen, setSolutionFormOpen] = useState(false);
  // Nhớ kiểu xem người dùng đã chọn để lần sau vào không phải đổi lại
  const [view, setView] = useState(() => localStorage.getItem('teachops.mat-view') || 'list');
  const [sort, setSort] = useState(() => localStorage.getItem('teachops.mat-sort') || 'moi-nhat');
  const [previewing, setPreviewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);   // [{id, title}] đang chờ xác nhận xoá
  const quickDownload = useQuickDownload();
  // Chọn từng bài để tải về — giữ qua các trang và khi đổi bộ lọc.
  const [selected, setSelected] = useState(() => new Map());

  const canOfficial = auth.can('material.official.write');
  const canTeacher = auth.can('material.teacher.write');
  const canWrite = area === 'official' ? canOfficial : canTeacher;
  // Chỉ Phòng chuyên môn và Quản trị viên được xoá học liệu.
  const canDelete = auth.can('material.delete');
  const canManage = () => canDelete;
  // Sửa thông tin: chủ sở hữu vẫn sửa được bài của mình.
  const canEdit = (m) => m.owner_id === auth.user?.id || auth.isAdmin || auth.isManager;

  const toggleOne = (m) => setSelected((s) => {
    const n = new Map(s);
    if (n.has(m.id)) n.delete(m.id); else n.set(m.id, m.title);
    return n;
  });
  const togglePage = (list, on) => setSelected((s) => {
    const n = new Map(s);
    for (const m of list) { if (on) n.set(m.id, m.title); else n.delete(m.id); }
    return n;
  });

  const loadTypes = useCallback(() => {
    api.get('/api/materials/types')
      .then((d) => setTypes(d?.items || []))
      .catch(() => setTypes([]));
  }, []);
  useEffect(() => { loadTypes(); }, [loadTypes]);

  // Danh mục giải pháp (UGOT, uKIT, Stick'em…) — trục duyệt chính của kho học liệu.
  const loadSolutions = useCallback(() => {
    api.get('/api/solutions')
      .then((d) => setSolutions(flattenSolutions(Array.isArray(d) ? d : d?.items || [])))
      .catch(() => setSolutions([]));
  }, []);
  useEffect(() => { loadSolutions(); }, [loadSolutions]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const d = await api.get('/api/materials', {
        sort: view === 'lesson' ? 'tiet' : sort,
        area,
        solution_id: solutionId || undefined,
        grade: grade || undefined,
        type_id: typeId || undefined,
        level: level || undefined,
        q,
        page,
        limit: view === 'lesson' ? 200 : LIMIT,
      });
      setData(d);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [area, solutionId, grade, typeId, level, q, page, sort, view]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title="Học liệu"
        sub="Duyệt theo giải pháp giảng dạy — trong mỗi giải pháp có giáo án, giáo trình, slide theo khối"
        actions={(
          <>
            <button className="btn-line" onClick={() => setDlOpen(true)}>
              ⬇ Tải về{selected.size ? ` (${selected.size})` : ''}
            </button>
            {canWrite && (
              <button className="btn-line" onClick={() => setBulkOpen(true)}>▦ Đăng hàng loạt</button>
            )}
            {canWrite && (
              <button className="btn-primary" onClick={() => setFormOpen(true)}>+ Đăng tài liệu</button>
            )}
          </>
        )}
      />

      {/* Bộ lọc — GIẢI PHÁP là trục chính, khối & loại nằm bên trong */}
      <div className="flex flex-col gap-2.5 mb-4">
        <ChipRow
          label="Giải pháp"
          value={solutionId}
          onChange={(v) => { setSolutionId(v); setPage(1); }}
          options={[{ value: '', label: 'Tất cả' },
            ...solutions.map((so) => ({ value: so.id, label: `🧩 ${so.label}` }))]}
          trailing={auth.isAdmin ? (
            <button
              type="button"
              onClick={() => setSolutionFormOpen(true)}
              className="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-brand-700
                         ring-1 ring-inset ring-brand-300 border border-dashed border-brand-300 hover:bg-brand-50">
              + Thêm giải pháp
            </button>
          ) : null}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            options={AREA_OPTIONS}
            value={area}
            onChange={(v) => { setArea(v); setPage(1); }}
          />
          <select
            className="input !w-auto !py-2"
            value={level}
            onChange={(e) => { setLevel(e.target.value); setPage(1); }}
            aria-label="Cấp học">
            <option value="">Mọi cấp học</option>
            {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <SearchBox
            className="flex-1 min-w-[180px]"
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="Tìm tiêu đề, tên bài, chương trình…"
          />
          <select
            className="input !w-auto !py-2"
            value={sort}
            disabled={view === 'lesson'}
            onChange={(e) => { setSort(e.target.value); localStorage.setItem('teachops.mat-sort', e.target.value); setPage(1); }}
            aria-label="Sắp xếp">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sắp xếp: {o.label}</option>)}
          </select>
          <Segmented
            value={view}
            onChange={(v) => { setView(v); localStorage.setItem('teachops.mat-view', v); setPage(1); }}
            options={[
              { value: 'list', label: '☰ Danh sách' },
              { value: 'card', label: '▦ Thẻ' },
              { value: 'lesson', label: '📖 Theo tiết' },
            ]}
          />
        </div>

        <ChipRow
          label="Khối"
          value={grade}
          onChange={(v) => { setGrade(v); setPage(1); }}
          options={[{ value: '', label: 'Tất cả' }, ...GRADES.map((g) => ({ value: g, label: `${g}` }))]}
        />
        <ChipRow
          label="Loại"
          value={typeId}
          onChange={(v) => { setTypeId(v); setPage(1); }}
          options={[{ value: '', label: 'Tất cả' }, ...types.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}` }))]}
        />
      </div>

      {solutionId && (
        <div className="card px-4 py-3 mb-3 flex items-center gap-3 !bg-brand-50/60 !border-brand-100">
          <span className="text-[22px]">📦</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[14.5px] text-brand-900 truncate">
              {solutions.find((so) => so.id === solutionId)?.label || 'Giải pháp'}
            </div>
            <div className="text-[12px] text-ink-muted">
              Toàn bộ học liệu của giải pháp này — chọn khối & loại phía trên để thu hẹp.
            </div>
          </div>
          <Link to="/giai-phap" className="btn-line !px-3 !py-1.5 shrink-0 text-[12.5px]">Chi tiết giải pháp</Link>
        </div>
      )}

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && data === null && <PageLoading />}

      {!error && data !== null && (
        items.length === 0 ? (
          <EmptyState
            icon="📚"
            title="Chưa có tài liệu nào khớp bộ lọc"
            hint={canWrite
              ? 'Đổi bộ lọc, hoặc bấm "+ Đăng tài liệu" để chia sẻ tài liệu đầu tiên.'
              : 'Thử đổi khối, loại tài liệu hoặc từ khoá tìm kiếm.'}
            action={canWrite && (
              <button className="btn-primary" onClick={() => setFormOpen(true)}>+ Đăng tài liệu</button>
            )}
          />
        ) : (
          <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
            {view === 'list' && (
              <MaterialTable items={items} area={area} selected={selected}
                onToggle={toggleOne} onTogglePage={togglePage}
                canManage={canManage} canEdit={canEdit} onDelete={setDeleting}
                onPreview={setPreviewing} onEdit={setEditing} />
            )}
            {view === 'card' && (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((m) => (
                  <MaterialCard key={m.id} m={m} area={area}
                    checked={selected.has(m.id)} onToggle={toggleOne}
                    canManage={canManage} canEdit={canEdit}
                    onPreview={setPreviewing} onEdit={setEditing}
                    onDownload={quickDownload} onDelete={setDeleting} />
                ))}
              </div>
            )}
            {view === 'lesson' && (
              <MaterialsLessonView items={items} area={area} canManage={canManage} canEdit={canEdit}
                onPreview={setPreviewing} onEdit={setEditing} onDownload={quickDownload} onDelete={setDeleting} />
            )}
          </div>
        )
      )}

      <Pager page={page} limit={LIMIT} total={data?.total} onPage={setPage} />

      {selected.size > 0 && (
        <div className="sticky bottom-[calc(76px+var(--safe-bot))] lg:bottom-4 z-30 mt-3 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-ink text-white shadow-card-lg px-4 py-2.5">
            <span className="text-[13.5px]">Đã chọn <b>{selected.size}</b> tài liệu</span>
            <button className="rounded-xl bg-white text-brand-900 font-semibold text-[13px] px-3 py-1.5 hover:bg-brand-50"
              onClick={() => setDlOpen(true)}>⬇ Tải các mục đã chọn</button>
            {canDelete && (
              <button className="rounded-xl bg-rose-500 text-white font-semibold text-[13px] px-3 py-1.5 hover:bg-rose-600"
                onClick={() => setDeleting([...selected].map(([id, title]) => ({ id, title })))}>🗑 Xoá</button>
            )}
            <button className="text-[13px] text-white/80 hover:text-white px-2"
              onClick={() => setSelected(new Map())}>Bỏ chọn</button>
          </div>
        </div>
      )}

      <EditMaterialSheet
        open={!!editing}
        material={editing}
        types={types}
        solutions={solutions}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load(); }}
      />

      <MaterialPreview
        open={!!previewing}
        material={previewing}
        onClose={() => setPreviewing(null)}
      />

      <DeleteMaterialSheet
        open={!!deleting}
        items={deleting || []}
        canHardDelete={canDelete}
        onClose={() => setDeleting(null)}
        onDone={(okIds) => {
          setDeleting(null);
          if (okIds.length) {
            setSelected((s) => { const n = new Map(s); okIds.forEach((id) => n.delete(id)); return n; });
            load();
          }
        }}
      />

      <MaterialsDownload
        open={dlOpen}
        onClose={() => setDlOpen(false)}
        filters={{ area, solutionId, grade, typeId, level, q }}
        selectedIds={[...selected.keys()]}
        types={types}
        solutionLabel={solutions.find((so) => so.id === solutionId)?.label.replace(/^(— )+/, '')}
        gradeLabel={grade ? `Khối ${grade}` : ''}
      />

      <MaterialsBulkUpload
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        area={area}
        canOfficial={canOfficial}
        canTeacher={canTeacher}
        types={types}
        solutions={solutions}
        defaultSolutionId={solutionId}
        defaultGrade={grade}
        onDone={(allOk) => {
          if (allOk) setBulkOpen(false);
          setPage(1);
          load();
        }}
      />

      <AddSolutionSheet
        open={solutionFormOpen}
        onClose={() => setSolutionFormOpen(false)}
        onCreated={(sol) => {
          setSolutionFormOpen(false);
          loadSolutions();
          if (sol?.id) { setSolutionId(sol.id); setPage(1); }
        }}
      />

      <UploadSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        area={area}
        defaultLevel={level || 'primary'}
        initialSolutionId={solutionId}
        types={types}
        onTypesChanged={loadTypes}
        onDone={() => { setFormOpen(false); setPage(1); load(); }}
      />
    </div>
  );
}
