/**
 * MaterialsBulkUpload.jsx — Đăng NHIỀU học liệu một lượt dạng bảng.
 *
 * Cách dùng nhanh nhất:
 *   1. Chọn giá trị chung (giải pháp, loại, khối, chương trình) — áp cho ô để trống.
 *   2. Kéo-thả cả thư mục tệp vào (hoặc bấm chọn nhiều tệp): mỗi tệp thành một dòng,
 *      tự đoán Tiêu đề / Tiết / Khối / Loại từ tên tệp (vd "UGOT_K6_Tiet05_Giao-an.docx").
 *   3. Có sẵn phân phối chương trình trong Excel? Bôi đen các cột
 *      Tiết · Tên bài · Tiêu đề · Loại · Khối · Chương trình → Ctrl+V vào bảng.
 *      Thả tệp sau đó sẽ tự ghép vào đúng dòng theo số tiết.
 *   4. Bấm "Đăng" — tải lần lượt từng tệp, dòng lỗi giữ lại để sửa và đăng lại.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmtSize, LABEL } from '../../lib/format.js';
import {
  findByName, firstInt, isTablePaste, levelOfGrade, norm, parseTsv,
} from '../../lib/tablePaste.js';
import { Field, Segmented, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { MAX_IMAGE_MB, MAX_MATERIAL_MB } from '../../lib/limits.js';

// Khớp danh sách định dạng máy chủ nhận (server/src/lib/storage.js).
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v', '3gp'];
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'zip',
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', ...VIDEO_EXT];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const MAX_ROWS = 200;
const PARALLEL = 2;
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
const baseName = (n) => String(n || '').replace(/\.[^.]+$/, '');
const prettyTitle = (n) => baseName(n).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

/** Số tiết trong tên tệp: "Tiet05", "Bài 5", "T05", "05 - …". */
function guessLesson(name) {
  const n = norm(baseName(name));
  const m = n.match(/(?:tiet|bai|lesson|buoi)\s*[-_.:]?\s*(\d{1,3})/)
    || n.match(/(?:^|[\s_-])[tb]\s*(\d{1,3})(?=$|[\s_.-])/)
    || n.match(/^(\d{1,3})(?=[\s_.-])/);
  const v = m ? Number(m[1]) : 0;
  return v >= 1 && v <= 500 ? v : '';
}

/** Khối trong tên tệp: "Khoi 6", "Lop6", "K6", "Grade 6". */
function guessGrade(name) {
  const n = norm(baseName(name));
  const m = n.match(/(?:khoi|lop|grade)\s*[-_.:]?\s*(\d{1,2})(?!\d)/)
    || n.match(/(?:^|[\s_-])k\s*(\d{1,2})(?=$|[\s_.-])/);
  const v = m ? Number(m[1]) : 0;
  return v >= 1 && v <= 12 ? v : '';
}

/** Loại tài liệu theo từ khoá trong tên tệp / đuôi tệp. */
function guessType(name, types) {
  const n = norm(name).replace(/[_.-]+/g, ' ');
  const ext = extOf(name);
  const find = (kw) => types.find((t) => norm(t.name).includes(kw))?.id || '';
  if (/giao an|\bga\b|ke hoach bai day|\bkhbd\b|lesson plan/.test(n)) return find('giao an');
  if (/giao trinh|curriculum/.test(n)) return find('giao trinh');
  if (/slide|bai giang/.test(n) || ext === 'ppt' || ext === 'pptx') return find('slide');
  if (/video/.test(n) || VIDEO_EXT.includes(ext)) return find('video');
  if (/nghien cuu/.test(n)) return find('nghien cuu');
  return '';
}

let seq = 0;
const newRow = (over = {}) => ({
  key: `r${++seq}`,
  file: null,
  title: '',
  type_id: '',
  grade: '',
  lesson_no: '',
  lesson_title: '',
  curriculum: '',
  solution_id: '',
  status: 'idle',     // idle | uploading | done | error
  error: '',
  ...over,
});

/** Lý do dòng chưa đăng được (null = hợp lệ). */
function rowProblem(r) {
  if (!r.file) return 'Chưa có tệp';
  if (!ALLOWED_EXT.includes(extOf(r.file.name))) return `Định dạng .${extOf(r.file.name)} chưa được hỗ trợ`;
  const limit = IMAGE_EXT.includes(extOf(r.file.name)) ? MAX_IMAGE_MB : MAX_MATERIAL_MB;
  if (r.file.size > limit * 1024 * 1024) return `Tệp lớn hơn ${limit}MB`;
  if (!r.title.trim()) return 'Thiếu tiêu đề';
  return null;
}

export default function MaterialsBulkUpload({
  open, onClose, area: initialArea, canOfficial, canTeacher,
  types, solutions, defaultSolutionId, defaultGrade, onDone,
}) {
  const toast = useToast();
  const fileInput = useRef(null);
  const rowFileInput = useRef(null);
  const [pickFor, setPickFor] = useState(null);     // key của dòng đang chọn tệp riêng
  const [drag, setDrag] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [common, setCommon] = useState({
    area: 'official', solution_id: '', type_id: '', grade: '', level: 'primary', curriculum: '', subject: '',
  });

  // Mở sheet ⇒ giá trị chung lấy theo bộ lọc đang xem ở trang Học liệu.
  useEffect(() => {
    if (!open) return;
    const g = defaultGrade ? Number(defaultGrade) : '';
    setCommon((c) => ({
      ...c,
      area: initialArea === 'teacher' || !canOfficial ? 'teacher' : 'official',
      solution_id: defaultSolutionId || '',
      grade: g,
      level: g ? levelOfGrade(g) : c.level,
    }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setC = (k, v) => setCommon((c) => {
    const next = { ...c, [k]: v };
    if (k === 'grade' && v) next.level = levelOfGrade(Number(v));
    return next;
  });

  const patchRow = useCallback((key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))), []);

  /** Thêm tệp: ghép vào dòng chưa có tệp cùng số tiết (nếu đã dán phân phối chương trình), còn lại tạo dòng mới. */
  const addFiles = useCallback((list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    setRows((rs) => {
      const out = [...rs];
      for (const f of files) {
        const lesson = guessLesson(f.name);
        const type = guessType(f.name, types);
        const idx = lesson
          ? out.findIndex((r) => !r.file && Number(r.lesson_no) === lesson
              && (!r.type_id || !type || r.type_id === type))
          : -1;
        if (idx >= 0) {
          const r = out[idx];
          out[idx] = {
            ...r,
            file: f,
            title: r.title || prettyTitle(f.name),
            type_id: r.type_id || type,
            grade: r.grade || guessGrade(f.name),
            status: 'idle',
            error: '',
          };
        } else if (out.length < MAX_ROWS) {
          out.push(newRow({
            file: f,
            title: prettyTitle(f.name),
            lesson_no: lesson,
            grade: guessGrade(f.name),
            type_id: type,
          }));
        }
      }
      return out;
    });
    if (rows.length + files.length > MAX_ROWS) toast.err(`Mỗi lượt tối đa ${MAX_ROWS} tệp — phần vượt đã bỏ qua.`);
  }, [types, rows.length, toast]);

  /** Dán từ Excel: Tiết · Tên bài · Tiêu đề · Loại · Khối · Chương trình. */
  const onPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!isTablePaste(text)) return;
    e.preventDefault();
    const data = parseTsv(text);
    const at = Number(e.target.closest?.('[data-row]')?.dataset.row);
    setRows((rs) => {
      const out = [...rs];
      let i = Number.isInteger(at) ? at : out.length;
      for (const c of data) {
        if (i >= MAX_ROWS) break;
        const lesson = firstInt(c[0]);
        const lessonTitle = c[1] || '';
        const patch = {
          lesson_no: lesson >= 1 && lesson <= 500 ? lesson : '',
          lesson_title: lessonTitle,
          title: c[2] || '',
          type_id: c[3] ? findByName(types, c[3], ['name']) : '',
          grade: (() => { const g = firstInt(c[4]); return g >= 1 && g <= 12 ? g : ''; })(),
          curriculum: c[5] || '',
        };
        const prev = out[i];
        if (!patch.title) {
          patch.title = prev?.title
            || [patch.lesson_no && `Tiết ${patch.lesson_no}`, lessonTitle].filter(Boolean).join(' — ');
        }
        out[i] = prev
          ? { ...prev, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== '')), status: 'idle', error: '' }
          : newRow(patch);
        i++;
      }
      return out;
    });
    toast.ok(`Đã dán ${data.length} dòng. Thả tệp vào để tự ghép theo số tiết.`);
  }, [types, toast]);

  const effective = (r, k) => r[k] || common[k];
  const levelFor = (r) => {
    const g = Number(effective(r, 'grade'));
    return g ? levelOfGrade(g) : common.level;
  };

  const pending = useMemo(() => rows.filter((r) => r.status !== 'done'), [rows]);
  const ready = useMemo(() => pending.filter((r) => !rowProblem(r)), [pending]);
  const doneCount = rows.length - pending.length;

  const submit = async () => {
    if (!ready.length) { toast.err('Chưa có dòng nào đủ tệp và tiêu đề.'); return; }
    const todo = [...ready];
    const leftover = pending.length - todo.length;   // dòng chưa đủ điều kiện, không gửi
    setBusy(true);
    setProgress({ done: 0, total: todo.length });
    const created = [];
    let failed = 0;
    let next = 0;

    const worker = async () => {
      while (next < todo.length) {
        const r = todo[next++];
        patchRow(r.key, { status: 'uploading', error: '' });
        const fd = new FormData();
        fd.append('batch', '1');
        fd.append('area', common.area);
        fd.append('title', r.title.trim());
        fd.append('level', levelFor(r));
        const grade = effective(r, 'grade');
        const typeId = effective(r, 'type_id');
        const solutionId = effective(r, 'solution_id');
        const curriculum = String(effective(r, 'curriculum') || '').trim();
        if (grade) fd.append('grade', String(grade));
        if (typeId) fd.append('type_id', typeId);
        if (solutionId) fd.append('solution_id', solutionId);
        if (curriculum) fd.append('curriculum', curriculum);
        if (common.subject.trim()) fd.append('subject', common.subject.trim());
        if (r.lesson_no) fd.append('lesson_no', String(r.lesson_no));
        if (r.lesson_title.trim()) fd.append('lesson_title', r.lesson_title.trim());
        fd.append('file', r.file, r.file.name);
        try {
          const m = await api.upload('/api/materials', fd);
          created.push(m.id);
          patchRow(r.key, { status: 'done', error: '' });
        } catch (e) {
          failed++;
          patchRow(r.key, { status: 'error', error: e.message || 'Tải lên thất bại' });
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));

    // Một thông báo tổng hợp cho GV/TG thay vì mỗi tệp một thông báo.
    if (created.length) await api.post('/api/materials/batch-done', { ids: created }).catch(() => {});
    setBusy(false);

    if (created.length) toast.ok(`Đã đăng ${created.length} tài liệu.`);
    if (failed) {
      toast.err(`${failed} tệp chưa đăng được — xem lý do ở cột trạng thái, sửa rồi bấm Đăng lại.`, 7000);
      onDone(false);
    } else if (leftover) {
      // Còn dòng thiếu tệp / sai định dạng ⇒ giữ bảng lại, chỉ ẩn các dòng đã đăng.
      setRows((rs) => rs.filter((r) => r.status !== 'done'));
      toast.err(`Còn ${leftover} dòng chưa đăng (thiếu tệp hoặc định dạng chưa hỗ trợ).`, 6000);
      onDone(false);
    } else {
      setRows([]);
      onDone(true);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (!busy) addFiles(e.dataTransfer?.files);
  };

  const cellInput = 'input !py-1.5 !px-2 text-[13px]';
  const commonSolution = solutions.find((s) => s.id === common.solution_id)?.label;
  const commonType = types.find((t) => t.id === common.type_id)?.name;

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide="xl" title="Đăng học liệu hàng loạt (dạng bảng)">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
        onDrop={onDrop}
        onPaste={onPaste}>
        <div className="rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 mb-3 text-[12.5px] text-brand-900 leading-relaxed">
          💡 <b>Kéo-thả nhiều tệp</b> (giáo án, slide, giáo trình…) vào khung bên dưới — mỗi tệp một dòng,
          tự đoán Tiết / Khối / Loại từ tên tệp (vd <i>UGOT_K6_Tiet05_Giao-an.docx</i>).
          Có phân phối chương trình trong Excel? Copy các cột <b>Tiết · Tên bài · Tiêu đề · Loại · Khối · Chương trình</b> rồi
          bấm <b>Ctrl+V</b> vào bảng — thả tệp sau sẽ tự ghép đúng dòng theo số tiết.
        </div>

        {/* Giá trị chung */}
        <div className="rounded-xl border border-line p-3 mb-3">
          <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted mb-2">
            Giá trị chung — tự áp cho các ô để trống ở từng dòng
          </div>
          {canOfficial && canTeacher && (
            <div className="mb-2.5">
              <Segmented
                value={common.area}
                onChange={(v) => setC('area', v)}
                options={[
                  { value: 'official', label: 'Kho Phòng chuyên môn (duyệt sẵn)' },
                  { value: 'teacher', label: 'Bài của Giáo viên (chờ duyệt)' },
                ]}
              />
            </div>
          )}
          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-x-2.5">
            <Field label="Giải pháp">
              <select className="input" value={common.solution_id} onChange={(e) => setC('solution_id', e.target.value)}>
                <option value="">— Không gắn —</option>
                {solutions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Loại tài liệu">
              <select className="input" value={common.type_id} onChange={(e) => setC('type_id', e.target.value)}>
                <option value="">— Theo tên tệp —</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
            </Field>
            <Field label="Khối">
              <select className="input" value={common.grade} onChange={(e) => setC('grade', e.target.value)}>
                <option value="">— Theo tên tệp —</option>
                {GRADES.map((g) => <option key={g} value={g}>Khối {g}</option>)}
              </select>
            </Field>
            <Field label="Cấp học" hint="Dòng có khối sẽ tự suy cấp.">
              <select className="input" value={common.level} onChange={(e) => setC('level', e.target.value)}>
                {Object.entries(LABEL.level).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Chương trình học">
              <input className="input" value={common.curriculum} onChange={(e) => setC('curriculum', e.target.value)}
                placeholder="VD: Robotics UGOT — HK1" />
            </Field>
            <Field label="Môn học">
              <input className="input" value={common.subject} onChange={(e) => setC('subject', e.target.value)}
                placeholder="VD: Robotics" />
            </Field>
          </div>
        </div>

        {/* Khung thả tệp */}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className={`w-full rounded-xl border-2 border-dashed px-4 py-5 mb-3 text-center transition
            ${drag ? 'border-brand-500 bg-brand-50' : 'border-brand-200 hover:border-brand-400 hover:bg-brand-50/50'}`}>
          <div className="text-[26px] leading-none mb-1">📥</div>
          <div className="font-semibold text-[14px] text-brand-900">Kéo-thả tệp vào đây, hoặc bấm để chọn nhiều tệp</div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            PDF, Word, PowerPoint, Excel, ZIP, video MP4/MOV (tối đa {MAX_MATERIAL_MB} MB) · ảnh (tối đa {MAX_IMAGE_MB} MB) · mỗi lượt tối đa {MAX_ROWS} tệp
          </div>
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ALLOWED_EXT.map((x) => `.${x}`).join(',')}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={rowFileInput}
          type="file"
          hidden
          accept={ALLOWED_EXT.map((x) => `.${x}`).join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && pickFor) {
              setRows((rs) => rs.map((r) => (r.key === pickFor
                ? { ...r, file: f, title: r.title || prettyTitle(f.name), status: 'idle', error: '' }
                : r)));
            }
            setPickFor(null);
            e.target.value = '';
          }}
        />

        {rows.length > 0 && (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[1240px] border-collapse">
              <thead>
                <tr>
                  <th className="th !w-8">#</th>
                  <th className="th !min-w-[280px]">Tệp · Tiêu đề *</th>
                  <th className="th !w-[140px]">Loại</th>
                  <th className="th !w-[96px]">Khối</th>
                  <th className="th !w-[64px]">Tiết</th>
                  <th className="th !w-[170px]">Tên bài</th>
                  <th className="th !w-[150px]">Chương trình</th>
                  <th className="th !w-[150px]">Giải pháp</th>
                  <th className="th !w-[150px]">Trạng thái</th>
                  <th className="th !w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const problem = r.status !== 'done' ? rowProblem(r) : null;
                  const locked = busy || r.status === 'done' || r.status === 'uploading';
                  return (
                    <tr key={r.key} data-row={i}
                      className={r.status === 'done' ? 'bg-emerald-50/60'
                        : r.status === 'error' ? 'bg-rose-50/60'
                          : problem ? 'bg-amber-50/40' : ''}>
                      <td className="td text-center text-ink-muted text-[12px]">{i + 1}</td>
                      <td className="td !p-1">
                        {r.file ? (
                          <button type="button" disabled={locked} title="Đổi tệp khác"
                            onClick={() => { setPickFor(r.key); rowFileInput.current?.click(); }}
                            className="w-full text-left rounded-md px-1.5 pb-0.5 text-[11.5px] text-ink-muted truncate hover:text-brand-800 disabled:hover:text-ink-muted">
                            📄 {r.file.name} · {fmtSize(r.file.size)}
                          </button>
                        ) : (
                          <button type="button" disabled={locked}
                            onClick={() => { setPickFor(r.key); rowFileInput.current?.click(); }}
                            className="rounded-md border border-dashed border-amber-400 text-amber-800 text-[11.5px] px-2 py-0.5 mb-1 hover:bg-amber-50">
                            📎 Chọn tệp cho dòng này
                          </button>
                        )}
                        <input className={cellInput} value={r.title} disabled={locked} placeholder="Tiêu đề tài liệu"
                          onChange={(e) => patchRow(r.key, { title: e.target.value })} />
                      </td>
                      <td className="td !p-1">
                        <select className={cellInput} value={r.type_id} disabled={locked}
                          onChange={(e) => patchRow(r.key, { type_id: e.target.value })}>
                          <option value="">{commonType ? `(chung) ${commonType}` : '—'}</option>
                          {types.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <select className={cellInput} value={r.grade} disabled={locked}
                          onChange={(e) => patchRow(r.key, { grade: e.target.value ? Number(e.target.value) : '' })}>
                          <option value="">{common.grade ? `(chung) ${common.grade}` : '—'}</option>
                          {GRADES.map((g) => <option key={g} value={g}>Khối {g}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <input className={cellInput} inputMode="numeric" value={r.lesson_no} disabled={locked}
                          onChange={(e) => { const v = firstInt(e.target.value); patchRow(r.key, { lesson_no: v >= 1 && v <= 500 ? v : '' }); }} />
                      </td>
                      <td className="td !p-1">
                        <input className={cellInput} value={r.lesson_title} disabled={locked}
                          onChange={(e) => patchRow(r.key, { lesson_title: e.target.value })} />
                      </td>
                      <td className="td !p-1">
                        <input className={cellInput} value={r.curriculum} disabled={locked}
                          placeholder={common.curriculum ? `(chung) ${common.curriculum}` : ''}
                          onChange={(e) => patchRow(r.key, { curriculum: e.target.value })} />
                      </td>
                      <td className="td !p-1">
                        <select className={cellInput} value={r.solution_id} disabled={locked}
                          onChange={(e) => patchRow(r.key, { solution_id: e.target.value })}>
                          <option value="">{commonSolution ? `(chung) ${commonSolution}` : '—'}</option>
                          {solutions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="td !py-1 text-[12px] leading-tight">
                        {r.status === 'done' && <span className="text-emerald-700 font-semibold">✅ Đã đăng</span>}
                        {r.status === 'uploading' && <span className="text-brand-700 inline-flex items-center gap-1"><Spinner className="h-3.5 w-3.5" /> Đang tải…</span>}
                        {r.status === 'error' && <span className="text-rose-700">❌ {r.error}</span>}
                        {r.status === 'idle' && (problem
                          ? <span className="text-amber-800">⚠ {problem}</span>
                          : <span className="text-ink-muted">Sẵn sàng</span>)}
                      </td>
                      <td className="td !p-1 text-center">
                        <button type="button" title="Xoá dòng" disabled={busy || r.status === 'uploading'}
                          className="px-1.5 text-rose-500 hover:text-rose-700 disabled:opacity-40"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button type="button" className="btn-line !py-2" disabled={busy || rows.length >= MAX_ROWS}
            onClick={() => setRows((rs) => [...rs, newRow()])}>
            + Thêm dòng trống
          </button>
          {doneCount > 0 && !busy && (
            <button type="button" className="btn-line !py-2"
              onClick={() => setRows((rs) => rs.filter((r) => r.status !== 'done'))}>
              Ẩn {doneCount} dòng đã đăng
            </button>
          )}
          {rows.length > 0 && (
            <span className="text-[12.5px] text-ink-muted">
              <b>{ready.length}</b>/{pending.length} dòng sẵn sàng
              {busy && <> · đang tải <b>{progress.done}/{progress.total}</b></>}
            </span>
          )}
        </div>

        {busy && progress.total > 0 && (
          <div className="h-1.5 rounded-full bg-brand-50 overflow-hidden mt-2">
            <div className="h-full bg-brand-grad transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Đóng</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy || !ready.length}>
            {busy
              ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang đăng {progress.done}/{progress.total}…</>
              : `Đăng ${ready.length} tài liệu`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
