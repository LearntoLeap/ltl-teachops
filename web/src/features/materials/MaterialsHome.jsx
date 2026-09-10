/**
 * MaterialsHome.jsx — Kho học liệu (/hoc-lieu).
 * Hai khu vực: Tài liệu Phòng chuyên môn (official) và Tài liệu Giáo viên (teacher),
 * lọc theo cấp học + tìm kiếm. Đăng tài liệu mới qua Sheet trượt (multipart).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtAgo, LABEL } from '../../lib/format.js';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Pager, SearchBox, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const LIMIT = 50;

const LEVEL_OPTIONS = ['primary', 'secondary', 'highschool']
  .map((v) => ({ value: v, label: LABEL.level[v] }));

const AREA_OPTIONS = [
  { value: 'official', label: 'Tài liệu Phòng chuyên môn' },
  { value: 'teacher', label: 'Tài liệu Giáo viên' },
];

/** Đoán icon theo đuôi tệp của phiên bản mới nhất. */
function fileIcon(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (ext === 'ppt' || ext === 'pptx') return '📊';
  if (ext === 'doc' || ext === 'docx') return '📘';
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

/* ------------------------------ Thẻ tài liệu ------------------------------ */
function MaterialCard({ m, area }) {
  const ownerName = m.owner_name || m.owner?.full_name || '';
  const at = m.updated_at || m.latest_version?.created_at || m.created_at;
  return (
    <Link
      to={`/hoc-lieu/${m.id}`}
      className="card p-3.5 flex items-start gap-3 hover:border-brand-300 transition">
      <span className="text-[26px] leading-none mt-0.5">{fileIcon(m.latest_version?.file_name)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-[14.5px] text-ink truncate max-w-full">{m.title}</span>
          {m.is_new && <Badge tone="new">Mới</Badge>}
          {area === 'teacher' && m.approval_status && (
            <Badge tone={m.approval_status}>{LABEL.approval[m.approval_status] || m.approval_status}</Badge>
          )}
        </div>
        <div className="text-[12.5px] text-ink-muted mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {m.subject && <span>{m.subject}</span>}
          {ownerName && <span>{ownerName}</span>}
          {at && <span>{fmtAgo(at)}</span>}
          {Number(m.comment_count) > 0 && <span>💬 {m.comment_count}</span>}
        </div>
      </div>
      <span className="text-ink-muted mt-1.5">›</span>
    </Link>
  );
}

/* --------------------------- Sheet đăng tài liệu --------------------------- */
function UploadSheet({ open, onClose, area, defaultLevel, onDone }) {
  const auth = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState(defaultLevel);
  const [solutionId, setSolutionId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);      // để reset input file sau khi gửi
  const [busy, setBusy] = useState(false);

  const [solutions, setSolutions] = useState(null);   // null = chưa tải
  const [classes, setClasses] = useState([]);

  // Mỗi lần mở: cấp học mặc định theo tab đang xem.
  useEffect(() => { if (open) setLevel(defaultLevel); }, [open, defaultLevel]);

  // Tải danh mục giải pháp một lần khi mở form lần đầu.
  useEffect(() => {
    if (!open || solutions !== null) return;
    api.get('/api/solutions')
      .then((d) => setSolutions(flattenSolutions(Array.isArray(d) ? d : d?.items || [])))
      .catch(() => setSolutions([]));
  }, [open, solutions]);

  // Chọn trường → nạp danh sách lớp của trường đó.
  useEffect(() => {
    if (!schoolId) { setClasses([]); setClassId(''); return; }
    let alive = true;
    api.get('/api/classes', { school_id: schoolId })
      .then((d) => { if (alive) setClasses(Array.isArray(d) ? d : d?.items || []); })
      .catch(() => { if (alive) setClasses([]); });
    return () => { alive = false; };
  }, [schoolId]);

  const reset = () => {
    setTitle(''); setSubject(''); setDescription('');
    setSolutionId(''); setSchoolId(''); setClassId('');
    setFile(null); setFileKey((k) => k + 1);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.err('Vui lòng nhập tiêu đề tài liệu.'); return; }
    if (!file) { toast.err('Vui lòng chọn tệp tài liệu.'); return; }

    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('area', area);
    fd.append('level', level);
    if (subject.trim()) fd.append('subject', subject.trim());
    if (description.trim()) fd.append('description', description.trim());
    if (solutionId) fd.append('solution_id', solutionId);
    if (schoolId) fd.append('school_id', schoolId);
    if (classId) fd.append('class_id', classId);
    fd.append('file', file, file.name);

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
            placeholder="Ví dụ: Slide bài 5 — Lập trình cảm biến" />
        </Field>

        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Môn học">
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Ví dụ: Robotics, Tin học…" />
          </Field>
          <Field label="Cấp học">
            <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Mô tả">
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Tóm tắt nội dung, phạm vi sử dụng…" />
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

        <Field label="Tệp tài liệu" required hint="Chấp nhận PDF, Word, PowerPoint, Excel — tối đa 15MB.">
          <input
            key={fileKey}
            type="file"
            className="input !py-2"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>

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
  const [level, setLevel] = useState('primary');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const canWrite = area === 'official'
    ? auth.can('material.official.write')
    : auth.can('material.teacher.write');

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const d = await api.get('/api/materials', { area, level, q, page, limit: LIMIT });
      setData(d);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [area, level, q, page]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title="Học liệu"
        sub="Kho tài liệu giảng dạy theo cấp học"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => setFormOpen(true)}>+ Đăng tài liệu</button>
        )}
      />

      <div className="flex flex-col gap-2.5 mb-4">
        <Segmented
          options={AREA_OPTIONS}
          value={area}
          onChange={(v) => { setArea(v); setPage(1); }}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            options={LEVEL_OPTIONS}
            value={level}
            onChange={(v) => { setLevel(v); setPage(1); }}
          />
          <SearchBox
            className="flex-1 min-w-[180px]"
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="Tìm theo tiêu đề, môn học…"
          />
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      {!error && data === null && <PageLoading />}

      {!error && data !== null && (
        items.length === 0 ? (
          <EmptyState
            icon="📚"
            title="Chưa có tài liệu nào"
            hint={canWrite
              ? 'Bấm "+ Đăng tài liệu" để chia sẻ tài liệu đầu tiên cho khu vực này.'
              : (area === 'official'
                ? 'Phòng chuyên môn chưa đăng tài liệu cho cấp học này. Hãy quay lại sau.'
                : 'Chưa có giáo viên nào chia sẻ tài liệu cho cấp học này.')}
            action={canWrite && (
              <button className="btn-primary" onClick={() => setFormOpen(true)}>+ Đăng tài liệu</button>
            )}
          />
        ) : (
          <div className={`grid gap-2.5 sm:grid-cols-2 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            {items.map((m) => <MaterialCard key={m.id} m={m} area={area} />)}
          </div>
        )
      )}

      <Pager page={page} limit={LIMIT} total={data?.total} onPage={setPage} />

      <UploadSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        area={area}
        defaultLevel={level}
        onDone={() => { setFormOpen(false); setPage(1); load(); }}
      />
    </div>
  );
}
