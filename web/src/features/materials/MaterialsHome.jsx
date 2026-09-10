/**
 * MaterialsHome.jsx — Kho học liệu (/hoc-lieu), bản nâng cấp "thư viện giảng dạy":
 *
 * - Lọc theo: khu vực (Phòng chuyên môn / Giáo viên) · KHỐI 1-12 (dải chip chọn nhanh)
 *   · LOẠI tài liệu (giáo án / giáo trình / slide / nghiên cứu / video / mục tự thêm)
 *   · cấp học · tìm kiếm.
 * - Thẻ tài liệu có ẢNH MINH HOẠ, dòng "Tiết – Tên bài – Chương trình học".
 * - Đăng tài liệu: tệp HOẶC nội dung tự do (bài viết), kèm ảnh bìa; admin/manager
 *   thêm loại tài liệu mới ngay trong form.
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

const LIMIT = 30;

const LEVEL_OPTIONS = ['primary', 'secondary', 'highschool']
  .map((v) => ({ value: v, label: LABEL.level[v] }));

const AREA_OPTIONS = [
  { value: 'official', label: 'Kho Phòng chuyên môn' },
  { value: 'teacher', label: 'Bài của Giáo viên' },
];

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

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

/* ------------------------------ Thẻ tài liệu ------------------------------ */
function MaterialCard({ m, area }) {
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
      className="card overflow-hidden flex hover:border-brand-300 hover:-translate-y-px transition group">
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

      <div className="min-w-0 flex-1 p-3">
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
      </div>
    </Link>
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

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.err('Vui lòng nhập tiêu đề tài liệu.'); return; }
    if (!file && !body.trim()) {
      toast.err('Cần đính kèm tệp HOẶC nhập nội dung bài viết.');
      return;
    }

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
          <Field label="Tệp tài liệu" hint="PDF, Word, PowerPoint, Excel, video — tối đa 15MB.">
            <input
              key={`f${fileKey}`}
              type="file"
              className="input !py-2"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.zip"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <Field label="Ảnh minh hoạ" hint="Hiển thị trên thẻ tài liệu ngoài danh sách.">
            <input
              key={`c${fileKey}`}
              type="file"
              className="input !py-2"
              accept="image/*"
              onChange={(e) => setCover(e.target.files?.[0] || null)}
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
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const canWrite = area === 'official'
    ? auth.can('material.official.write')
    : auth.can('material.teacher.write');

  const loadTypes = useCallback(() => {
    api.get('/api/materials/types')
      .then((d) => setTypes(d?.items || []))
      .catch(() => setTypes([]));
  }, []);
  useEffect(() => { loadTypes(); }, [loadTypes]);

  // Danh mục giải pháp (UGOT, uKIT, Stick'em…) — trục duyệt chính của kho học liệu.
  useEffect(() => {
    api.get('/api/solutions')
      .then((d) => setSolutions(flattenSolutions(Array.isArray(d) ? d : d?.items || [])))
      .catch(() => setSolutions([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const d = await api.get('/api/materials', {
        area,
        solution_id: solutionId || undefined,
        grade: grade || undefined,
        type_id: typeId || undefined,
        level: level || undefined,
        q,
        page,
        limit: LIMIT,
      });
      setData(d);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [area, solutionId, grade, typeId, level, q, page]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title="Học liệu"
        sub="Duyệt theo giải pháp giảng dạy — trong mỗi giải pháp có giáo án, giáo trình, slide theo khối"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => setFormOpen(true)}>+ Đăng tài liệu</button>
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
            <Link
              to="/giai-phap"
              className="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-brand-700
                         ring-1 ring-inset ring-brand-300 border border-dashed border-brand-300 hover:bg-brand-50">
              + Thêm giải pháp
            </Link>
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
          <div className={`grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            {items.map((m) => <MaterialCard key={m.id} m={m} area={area} />)}
          </div>
        )
      )}

      <Pager page={page} limit={LIMIT} total={data?.total} onPage={setPage} />

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
