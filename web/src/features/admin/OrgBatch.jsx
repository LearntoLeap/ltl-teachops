/**
 * OrgBatch.jsx — Nhập TRƯỜNG và LỚP dạng bảng (Admin / Phòng chuyên môn).
 *
 * Đầu năm học thường phải khai hàng chục trường, hàng trăm lớp — nhập từng form rất chậm.
 * Hai bảng ở đây cho điền thẳng như Excel, hoặc tải tệp mẫu → điền → copy → Ctrl+V.
 * Gửi một lượt lên /api/schools/batch, /api/classes/batch: dòng tạo được sẽ biến mất khỏi
 * bảng, dòng lỗi ở lại kèm lý do để sửa và gửi lại.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { LABEL } from '../../lib/format.js';
import {
  findByName, firstInt, isTablePaste, levelOfGrade, norm, parseLevel, parseTsv,
} from '../../lib/tablePaste.js';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const listOf = (r) => (Array.isArray(r) ? r : r?.items || []);
const cell = 'input !py-1.5 !px-2 text-[13px]';
let seq = 0;
const key = () => `k${++seq}`;

/** '21.1861, 106.0763' · '21.1861 106.0763' → { lat, lng }; không đọc được → rỗng. */
function parseGps(v) {
  const m = String(v || '').match(/(-?\d{1,3}(?:[.]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.]\d+)?)/);
  return m ? { lat: m[1], lng: m[2] } : { lat: '', lng: '' };
}

/** Nạp toàn bộ trường trong phạm vi (API phân trang tối đa 200/trang). */
async function loadAllSchools() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await api.get('/api/schools', { limit: 200, page });
    out.push(...listOf(r));
    if (out.length >= (r?.total || 0) || !listOf(r).length) break;
  }
  return out;
}

function TemplateButton({ path, name }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn-line !py-1.5 !px-3 text-[12.5px] shrink-0" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await api.download(path, undefined, name); } catch (e) { toast.fromError(e); } finally { setBusy(false); }
      }}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : '📄'} Tải tệp mẫu Excel
    </button>
  );
}

function ResultNote({ result }) {
  if (!result?.skipped?.length) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 mt-3 text-[12.5px] text-amber-900">
      Đã tạo <b>{result.created}</b> · <b>{result.skipped.length}</b> dòng chưa tạo được — lý do ghi ngay
      dưới từng dòng. Sửa rồi bấm gửi lại.
    </div>
  );
}

/**
 * Gửi các dòng hợp lệ; dòng tạo xong bị gỡ khỏi bảng, dòng lỗi giữ lại kèm lý do.
 * `toPayload(row)` trả object gửi API, hoặc null nếu dòng trống cần bỏ qua.
 */
async function submitRows({ url, rows, setRows, toPayload }) {
  const sent = [];
  const payload = [];
  for (const r of rows) {
    const p = toPayload(r);
    if (p) { sent.push(r.key); payload.push(p); }
  }
  if (!payload.length) return null;
  const out = await api.post(url, { rows: payload });
  const failed = new Map(out.skipped.map((s) => [sent[s.row - 1], s.reason]));
  setRows((rs) => {
    const left = rs
      .filter((r) => !sent.includes(r.key) || failed.has(r.key))
      .map((r) => (failed.has(r.key) ? { ...r, error: failed.get(r.key) } : r));
    return left;
  });
  return out;
}

/* ================================ TRƯỜNG ================================== */

const emptySchool = () => ({
  key: key(), code: '', name: '', address: '', province: '', gps: '',
  gps_radius_m: '', grace_minutes: '', contact_name: '', contact_phone: '', error: '',
});

export function SchoolBatchSheet({ open, onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => [emptySchool()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const setCell = (k, f, v) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, [f]: v, error: '' } : r)));

  /** Dán theo mẫu: Mã · Tên · Địa chỉ · Tỉnh · Toạ độ · Bán kính · Ân hạn · Người liên hệ · SĐT. */
  const onPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!isTablePaste(text)) return;
    e.preventDefault();
    const data = parseTsv(text).filter((c) => !norm(c[0]).startsWith('ma truong'));
    const parsed = data.map((c) => ({
      ...emptySchool(),
      code: c[0] || '', name: c[1] || '', address: c[2] || '', province: c[3] || '', gps: c[4] || '',
      gps_radius_m: c[5] ? String(firstInt(c[5])) : '', grace_minutes: c[6] ? String(firstInt(c[6])) : '',
      contact_name: c[7] || '', contact_phone: c[8] || '',
    }));
    setRows((rs) => [...rs.filter((r) => r.code || r.name), ...parsed]);
    toast.ok(`Đã dán ${parsed.length} trường.`);
  }, [toast]);

  const filled = rows.filter((r) => r.code.trim() || r.name.trim());
  const ready = filled.filter((r) => r.code.trim() && r.name.trim());

  const submit = async () => {
    setBusy(true);
    try {
      const out = await submitRows({
        url: '/api/schools/batch',
        rows: filled,
        setRows,
        toPayload: (r) => {
          const { lat, lng } = parseGps(r.gps);
          return {
            code: r.code.trim(),
            name: r.name.trim(),
            address: r.address.trim() || undefined,
            province: r.province.trim() || undefined,
            lat: lat || undefined,
            lng: lng || undefined,
            gps_radius_m: r.gps_radius_m || undefined,
            grace_minutes: r.grace_minutes || undefined,
            contact_name: r.contact_name.trim() || undefined,
            contact_phone: r.contact_phone.trim() || undefined,
          };
        },
      });
      if (!out) { toast.err('Chưa có dòng nào có Mã và Tên trường.'); return; }
      setResult(out);
      if (out.created) toast.ok(`Đã tạo ${out.created} trường.`);
      if (!out.skipped.length) { setRows([emptySchool()]); onDone(true); } else onDone(false);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide="xl" title="Nhập danh sách trường dạng bảng">
      <div onPaste={onPaste}>
        <div className="flex flex-wrap items-start gap-3 rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 mb-3 text-[12.5px] text-brand-900">
          <div className="flex-1 min-w-[260px]">
            💡 Điền thẳng vào bảng, hoặc tải tệp mẫu → điền trong Excel → bôi đen các dòng → Copy →
            bấm <b>Ctrl+V</b> vào bảng. Thứ tự cột: <b>Mã · Tên · Địa chỉ · Tỉnh · Toạ độ GPS · Bán kính · Ân hạn · Người liên hệ · SĐT</b>.
            Toạ độ dán nguyên dạng Google Maps <i>21.1861, 106.0763</i>. Bỏ trống bán kính / ân hạn = mặc định 1.000 m / 10 phút.
          </div>
          <TemplateButton path="/api/schools/batch-template" name="mau-nhap-truong.xlsx" />
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[1360px] border-collapse">
            <thead>
              <tr>
                <th className="th !w-8">#</th>
                <th className="th !w-[120px]">Mã trường *</th>
                <th className="th !w-[200px]">Tên trường *</th>
                <th className="th !min-w-[200px]">Địa chỉ</th>
                <th className="th !w-[120px]">Tỉnh / TP</th>
                <th className="th !w-[170px]">Toạ độ GPS</th>
                <th className="th !w-[90px]">Bán kính (m)</th>
                <th className="th !w-[80px]">Ân hạn (ph)</th>
                <th className="th !w-[150px]">Người liên hệ</th>
                <th className="th !w-[120px]">SĐT</th>
                <th className="th !w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                  <tr className={r.error ? 'bg-rose-50/60' : ''}>
                    <td className="td text-center text-ink-muted text-[12px]">{i + 1}</td>
                    <td className="td !p-1"><input className={cell} value={r.code} placeholder="THCS-NT01" onChange={(e) => setCell(r.key, 'code', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.name} placeholder="THCS Nguyễn Trãi" onChange={(e) => setCell(r.key, 'name', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.address} onChange={(e) => setCell(r.key, 'address', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.province} onChange={(e) => setCell(r.key, 'province', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.gps} placeholder="21.1861, 106.0763" onChange={(e) => setCell(r.key, 'gps', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} inputMode="numeric" value={r.gps_radius_m} placeholder="1000" onChange={(e) => setCell(r.key, 'gps_radius_m', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} inputMode="numeric" value={r.grace_minutes} placeholder="10" onChange={(e) => setCell(r.key, 'grace_minutes', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.contact_name} onChange={(e) => setCell(r.key, 'contact_name', e.target.value)} /></td>
                    <td className="td !p-1"><input className={cell} value={r.contact_phone} onChange={(e) => setCell(r.key, 'contact_phone', e.target.value)} /></td>
                    <td className="td !p-1 text-center">
                      <button type="button" title="Xoá dòng" className="px-1.5 text-rose-500 hover:text-rose-700"
                        onClick={() => setRows((rs) => (rs.length === 1 ? [emptySchool()] : rs.filter((x) => x.key !== r.key)))}>✕</button>
                    </td>
                  </tr>
                  {r.error && (
                    <tr className="bg-rose-50/60">
                      <td />
                      <td colSpan={10} className="px-2 pb-1.5 text-[12px] text-rose-700">❌ {r.error}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button type="button" className="btn-line !py-2" onClick={() => setRows((rs) => [...rs, emptySchool()])}>+ Thêm dòng</button>
          <span className="text-[12.5px] text-ink-muted"><b>{ready.length}</b>/{filled.length} dòng đủ Mã và Tên</span>
        </div>
        <ResultNote result={result} />

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Đóng</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy || !filled.length}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : `Tạo ${filled.length} trường`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ================================== LỚP =================================== */

const emptyClass = (schoolId = '') => ({
  key: key(), school_id: schoolId, school_text: '', name: '', grade: '', level: '', roster_size: '',
  teacher_id: '', teacher_text: '', assistant_id: '', assistant_text: '', note: '', error: '',
});

/**
 * @param fixedSchool  { id, name } — mở từ trang một trường: mọi dòng thuộc trường đó.
 */
export function ClassBatchSheet({ open, onClose, fixedSchool = null, onDone }) {
  const toast = useToast();
  const [schools, setSchools] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assistants, setAssistants] = useState([]);
  const [loadingRes, setLoadingRes] = useState(false);
  const [defaultSchool, setDefaultSchool] = useState(fixedSchool?.id || '');
  const [rows, setRows] = useState(() => [emptyClass(fixedSchool?.id || '')]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoadingRes(true);
    Promise.all([
      fixedSchool ? Promise.resolve([fixedSchool]) : loadAllSchools(),
      api.get('/api/users', { role: 'teacher', limit: 200 }),
      api.get('/api/users', { role: 'assistant', limit: 200 }),
    ]).then(([s, t, a]) => {
      if (!alive) return;
      setSchools(s);
      setTeachers(listOf(t));
      setAssistants(listOf(a));
    }).catch((e) => { if (alive) toast.fromError(e); })
      .finally(() => { if (alive) setLoadingRes(false); });
    return () => { alive = false; };
  }, [open, fixedSchool?.id, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chọn trường mặc định ⇒ điền cho các dòng chưa có trường.
  useEffect(() => {
    if (!defaultSchool) return;
    setRows((rs) => rs.map((r) => (!r.school_id && !r.school_text ? { ...r, school_id: defaultSchool } : r)));
  }, [defaultSchool]);

  const setCell = (k, f, v) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, [f]: v, error: '' } : r)));

  /**
   * Dán theo mẫu 8 cột: Trường · Tên lớp · Khối · Cấp học · Sĩ số · Giáo viên · Trợ giảng · Ghi chú.
   * Chỉ 7 cột ⇒ hiểu là bỏ cột Trường, dùng trường đang chọn.
   */
  const onPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!isTablePaste(text)) return;
    e.preventDefault();
    const data = parseTsv(text).filter((c) => !c.some((x) => norm(x) === 'ten lop' || norm(x) === 'ten lop *'));
    const withSchool = Math.max(...data.map((c) => c.length)) >= 8;
    const parsed = data.map((raw) => {
      const c = withSchool ? raw : ['', ...raw];
      const schoolId = fixedSchool?.id
        || (c[0] ? findByName(schools, c[0], ['code', 'name']) : defaultSchool);
      const g = firstInt(c[2]);
      return {
        ...emptyClass(),
        school_id: schoolId,
        school_text: schoolId ? '' : c[0],
        name: c[1] || '',
        grade: g >= 1 && g <= 12 ? String(g) : '',
        level: parseLevel(c[3]),
        roster_size: c[4] ? String(firstInt(c[4])) : '',
        teacher_id: c[5] ? findByName(teachers, c[5], ['full_name', 'email']) : '',
        teacher_text: c[5] || '',
        assistant_id: c[6] ? findByName(assistants, c[6], ['full_name', 'email']) : '',
        assistant_text: c[6] || '',
        note: c[7] || '',
      };
    });
    setRows((rs) => [...rs.filter((r) => r.name), ...parsed]);
    const miss = parsed.filter((r) => !r.school_id).length
      + parsed.filter((r) => r.teacher_text && !r.teacher_id).length
      + parsed.filter((r) => r.assistant_text && !r.assistant_id).length;
    toast.ok(`Đã dán ${parsed.length} lớp.` + (miss ? ` ${miss} ô chưa khớp tên (tô vàng) — chọn tay giúp.` : ''));
  }, [schools, teachers, assistants, fixedSchool, defaultSchool, toast]);

  const filled = rows.filter((r) => r.name.trim());
  const problem = (r) => {
    if (!r.school_id) return 'Chưa chọn trường';
    if (!r.grade && !r.level) return 'Cần Khối hoặc Cấp học';
    return null;
  };
  const ready = filled.filter((r) => !problem(r));

  const submit = async () => {
    if (!ready.length) { toast.err('Chưa có dòng nào đủ Trường, Tên lớp và Khối/Cấp học.'); return; }
    setBusy(true);
    try {
      const out = await submitRows({
        url: '/api/classes/batch',
        rows: ready,
        setRows,
        toPayload: (r) => ({
          school_id: r.school_id,
          name: r.name.trim(),
          grade: r.grade || undefined,
          level: r.level || undefined,
          roster_size: r.roster_size || undefined,
          teacher_id: r.teacher_id || undefined,
          assistant_id: r.assistant_id || undefined,
          note: r.note.trim() || undefined,
        }),
      });
      setResult(out);
      if (out.created) toast.ok(`Đã tạo ${out.created} lớp.`);
      const allDone = !out.skipped.length && ready.length === filled.length;
      if (allDone) { setRows([emptyClass(fixedSchool?.id || defaultSchool)]); onDone(true); } else onDone(false);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const unmatched = 'ring-2 ring-amber-300';

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide="xl"
      title={fixedSchool ? `Nhập lớp dạng bảng — ${fixedSchool.name}` : 'Nhập danh sách lớp dạng bảng'}>
      <div onPaste={onPaste}>
        <div className="flex flex-wrap items-start gap-3 rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 mb-3 text-[12.5px] text-brand-900">
          <div className="flex-1 min-w-[260px]">
            💡 Điền thẳng vào bảng, hoặc tải tệp mẫu → điền → Copy → <b>Ctrl+V</b> vào bảng. Thứ tự cột:
            <b> Trường · Tên lớp · Khối · Cấp học · Sĩ số · Giáo viên · Trợ giảng · Ghi chú</b>
            {' '}(bỏ cột Trường cũng được — dùng trường {fixedSchool ? 'này' : 'mặc định bên dưới'}).
            Cấp học để trống sẽ tự suy từ Khối. Tên GV/TG được dò gần đúng theo họ tên hoặc email.
          </div>
          <TemplateButton path="/api/classes/batch-template" name="mau-nhap-lop.xlsx" />
        </div>

        {!fixedSchool && (
          <Field label="Trường mặc định" hint="Dùng cho dòng mới và dòng dán vào mà để trống cột Trường.">
            <select className="input" value={defaultSchool} onChange={(e) => setDefaultSchool(e.target.value)}>
              <option value="">— Chọn trường —</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </Field>
        )}

        {loadingRes ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-muted py-3">
            <Spinner className="h-4 w-4" /> Đang tải danh sách trường và giáo viên…
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[1150px] border-collapse">
              <thead>
                <tr>
                  <th className="th !w-8">#</th>
                  {!fixedSchool && <th className="th !w-[200px]">Trường *</th>}
                  <th className="th !w-[100px]">Tên lớp *</th>
                  <th className="th !w-[92px]">Khối</th>
                  <th className="th !w-[120px]">Cấp học</th>
                  <th className="th !w-[76px]">Sĩ số</th>
                  <th className="th">Giáo viên phụ trách</th>
                  <th className="th">Trợ giảng phụ trách</th>
                  <th className="th !w-[150px]">Ghi chú</th>
                  <th className="th !w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = r.name.trim() ? problem(r) : null;
                  const cols = fixedSchool ? 9 : 10;
                  return (
                    <Fragment key={r.key}>
                      <tr className={r.error ? 'bg-rose-50/60' : p ? 'bg-amber-50/40' : ''}>
                        <td className="td text-center text-ink-muted text-[12px]">{i + 1}</td>
                        {!fixedSchool && (
                          <td className="td !p-1">
                            <select className={`${cell} ${!r.school_id && r.school_text ? unmatched : ''}`}
                              value={r.school_id} onChange={(e) => setCell(r.key, 'school_id', e.target.value)}
                              title={r.school_text ? `Đã dán: "${r.school_text}"` : undefined}>
                              <option value="">{r.school_text ? `? ${r.school_text}` : '—'}</option>
                              {schools.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                            </select>
                          </td>
                        )}
                        <td className="td !p-1"><input className={cell} value={r.name} placeholder="6A1" onChange={(e) => setCell(r.key, 'name', e.target.value)} /></td>
                        <td className="td !p-1">
                          <select className={cell} value={r.grade} onChange={(e) => setCell(r.key, 'grade', e.target.value)}>
                            <option value="">—</option>
                            {Array.from({ length: 12 }, (_, k) => k + 1).map((g) => <option key={g} value={g}>Khối {g}</option>)}
                          </select>
                        </td>
                        <td className="td !p-1">
                          <select className={cell} value={r.level} onChange={(e) => setCell(r.key, 'level', e.target.value)}>
                            <option value="">{r.grade ? `(tự) ${LABEL.level[levelOfGrade(Number(r.grade))]}` : '—'}</option>
                            {Object.entries(LABEL.level).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                        <td className="td !p-1"><input className={cell} inputMode="numeric" value={r.roster_size} placeholder="0" onChange={(e) => setCell(r.key, 'roster_size', e.target.value)} /></td>
                        <td className="td !p-1">
                          <select className={`${cell} ${!r.teacher_id && r.teacher_text ? unmatched : ''}`}
                            value={r.teacher_id} onChange={(e) => setCell(r.key, 'teacher_id', e.target.value)}>
                            <option value="">{r.teacher_text && !r.teacher_id ? `? ${r.teacher_text}` : '—'}</option>
                            {teachers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                          </select>
                        </td>
                        <td className="td !p-1">
                          <select className={`${cell} ${!r.assistant_id && r.assistant_text ? unmatched : ''}`}
                            value={r.assistant_id} onChange={(e) => setCell(r.key, 'assistant_id', e.target.value)}>
                            <option value="">{r.assistant_text && !r.assistant_id ? `? ${r.assistant_text}` : '—'}</option>
                            {assistants.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                          </select>
                        </td>
                        <td className="td !p-1"><input className={cell} value={r.note} onChange={(e) => setCell(r.key, 'note', e.target.value)} /></td>
                        <td className="td !p-1 text-center">
                          <button type="button" title="Xoá dòng" className="px-1.5 text-rose-500 hover:text-rose-700"
                            onClick={() => setRows((rs) => (rs.length === 1
                              ? [emptyClass(fixedSchool?.id || defaultSchool)]
                              : rs.filter((x) => x.key !== r.key)))}>✕</button>
                        </td>
                      </tr>
                      {(r.error || p) && (
                        <tr className={r.error ? 'bg-rose-50/60' : 'bg-amber-50/40'}>
                          <td />
                          <td colSpan={cols - 1} className={`px-2 pb-1.5 text-[12px] ${r.error ? 'text-rose-700' : 'text-amber-800'}`}>
                            {r.error ? `❌ ${r.error}` : `⚠ ${p}`}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button type="button" className="btn-line !py-2"
            onClick={() => setRows((rs) => [...rs, emptyClass(fixedSchool?.id || defaultSchool)])}>+ Thêm dòng</button>
          <span className="text-[12.5px] text-ink-muted"><b>{ready.length}</b>/{filled.length} dòng sẵn sàng</span>
        </div>
        <ResultNote result={result} />

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Đóng</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy || !ready.length}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : `Tạo ${ready.length} lớp`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
