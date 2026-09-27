/**
 * BatchEntry.jsx — Nhập lịch dạy dạng BẢNG, cho Admin / Phòng chuyên môn.
 *
 * Mục đích: xếp lịch đầu kỳ thường là hàng chục buổi khác nhau (khác lớp, khác
 * tiết, khác giáo viên). Nhập từng buổi qua form quá chậm, nên màn hình này cho
 * điền thẳng trên lưới giống Excel:
 *   - Chọn trường một lần ở đầu → mọi dòng dùng chung, chỉ điền phần khác nhau.
 *   - Xếp theo TIẾT (không phải giờ): giờ vào/ra suy từ khung tiết của trường.
 *   - Giáo viên / trợ giảng: chọn trong danh sách HOẶC gõ tay tên người chưa có
 *     tài khoản — máy chủ lưu tên gõ tay và vẫn tạo buổi.
 *   - Ba lối nhập cùng đổ về một chỗ: gõ tay · dán từ Excel (Ctrl+V) · tải tệp
 *     Excel đã điền theo mẫu.
 *   - Điện thoại (<768px): mỗi dòng là một thẻ xếp dọc, không phải vuốt ngang.
 *
 * Gửi lên POST /api/schedules/batch — dòng lỗi bị bỏ qua và báo rõ số dòng,
 * các dòng còn lại vẫn được tạo. Thiếu thông tin thì bị NHẮC, không bị chặn tải lên.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { TemplateButton, ImportButton } from '../../components/TableIO.jsx';
import { useToast } from '../../components/Toast.jsx';
import { today } from '../../lib/format.js';
import { findByName } from '../../lib/tablePaste.js';

const listOf = (r) => (Array.isArray(r) ? r : r?.items || []);

/** Một dòng trống. Giữ tiết/người của dòng trước để điền tiếp cho nhanh. */
const emptyRow = (prev) => ({
  session_date: prev?.session_date || today(),
  period: prev?.period || '',
  class_id: '',
  teacher_id: prev?.teacher_id || '',
  teacher_text: prev?.teacher_text || '',
  assistant_id: prev?.assistant_id || '',
  assistant_text: prev?.assistant_text || '',
  room_id: prev?.room_id || '',
  subject: prev?.subject || '',
});

/** 'ngày 8/9', '08/09/2026', '2026-09-08' → '2026-09-08'. Không hiểu thì trả nguyên. */
function parseDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (!m) return s;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  let y = m[3] || String(new Date().getFullYear());
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo}-${d}`;
}

/** 'Tiết 3', '3', '03' → '3'. Không phải số thì trả rỗng. */
function parsePeriod(v) {
  const n = String(v ?? '').match(/\d{1,2}/);
  return n ? String(Number(n[0])) : '';
}

/** Ô nhìn như giờ (08:00, 8h, 0800) — dùng để nhận ra dữ liệu dán theo mẫu CŨ. */
const looksLikeTime = (v) => /^\s*\d{1,2}\s*([:h.]\s*\d{1,2})?\s*$/i.test(String(v || '')) && /[:h.]/i.test(String(v || ''));

export default function BatchEntry({ open, onClose, schools, onDone }) {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [res, setRes] = useState({ classes: [], rooms: [], teachers: [], assistants: [] });
  const [periods, setPeriods] = useState([]);
  const [loadingRes, setLoadingRes] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { created, skipped[] }

  // Chọn trường → nạp lớp / phòng / giáo viên / trợ giảng / khung tiết của trường đó
  useEffect(() => {
    if (!schoolId) { setRes({ classes: [], rooms: [], teachers: [], assistants: [] }); setPeriods([]); return undefined; }
    let alive = true;
    setLoadingRes(true);
    Promise.all([
      api.get('/api/classes', { school_id: schoolId, limit: 200 }),
      api.get('/api/rooms', { school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'teacher', school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'assistant', school_id: schoolId, limit: 200 }),
      api.get('/api/periods', { school_id: schoolId }),
      // Người ngoài phạm vi trường vẫn được chọn: trợ giảng hay chạy nhiều trường.
      api.get('/api/users', { role: 'teacher', limit: 200 }).catch(() => []),
      api.get('/api/users', { role: 'assistant', limit: 200 }).catch(() => []),
    ]).then(([c, r, t, a, p, tAll, aAll]) => {
      if (!alive) return;
      // Người của trường lên trước, người trường khác nối sau, bỏ trùng theo id.
      const merge = (near, far) => {
        const seen = new Set(listOf(near).map((u) => u.id));
        return [...listOf(near), ...listOf(far).filter((u) => !seen.has(u.id))];
      };
      setRes({
        classes: listOf(c),
        rooms: listOf(r),
        teachers: merge(t, tAll),
        assistants: merge(a, aAll),
      });
      setPeriods(listOf(p));
    }).catch((e) => { if (alive) toast.fromError(e); })
      .finally(() => { if (alive) setLoadingRes(false); });
    return () => { alive = false; };
  }, [schoolId, toast]);

  const setCell = (i, key, val) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  /**
   * Gõ tên người vào ô: khớp được với tài khoản thì gắn id, không khớp thì giữ
   * nguyên chữ — máy chủ nhận tên gõ tay cho người chưa có tài khoản.
   */
  const setPerson = (i, kind, text) => {
    const pool = kind === 'teacher' ? res.teachers : res.assistants;
    const id = text ? findByName(pool, text, ['full_name', 'email']) : '';
    setRows((rs) => rs.map((r, idx) => (idx === i
      ? { ...r, [`${kind}_text`]: text, [`${kind}_id`]: id || '' }
      : r)));
  };

  const addRow = () => setRows((rs) => [...rs, emptyRow(rs[rs.length - 1])]);
  const dupRow = (i) => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i], class_id: '' }, ...rs.slice(i + 1)]);
  const delRow = (i) => setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));

  /**
   * Đổ các dòng chữ vào bảng — dùng chung cho dán (Ctrl+V) và tải tệp Excel.
   * Thứ tự cột của mẫu: Ngày · Tiết · Lớp · Giáo viên · Trợ giảng · Phòng · Nội dung.
   * Vẫn nhận mẫu cũ (Ngày · Bắt đầu · Kết thúc · Lớp · …) bằng cách nhận ra ô giờ.
   */
  const applyRows = useCallback((data) => {
    const parsed = data.map((raw) => {
      const oldFormat = looksLikeTime(raw[1]) || looksLikeTime(raw[2]);
      const c = oldFormat ? [raw[0], raw[3], raw[4], raw[5], raw[6], raw[7]] : raw.slice(1);
      const teacherText = (c[2] || '').trim();
      const assistantText = (c[3] || '').trim();
      return {
        ...emptyRow(),
        session_date: parseDate(raw[0]),
        period: oldFormat ? '' : parsePeriod(raw[1]),
        class_id: findByName(res.classes, c[1]),
        teacher_text: teacherText,
        teacher_id: teacherText ? findByName(res.teachers, teacherText, ['full_name', 'email']) : '',
        assistant_text: assistantText,
        assistant_id: assistantText ? findByName(res.assistants, assistantText, ['full_name', 'email']) : '',
        room_id: findByName(res.rooms, c[4]),
        subject: (c[5] || '').trim(),
      };
    });
    setRows((rs) => [...rs.filter((r) => r.class_id || r.subject), ...parsed]);
    const thieu = parsed.filter((r) => !r.session_date || !r.period || !r.class_id).length;
    return { count: parsed.length, thieu };
  }, [res]);

  const onPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !text.includes('\t')) return;     // dán 1 ô thì để trình duyệt xử lý
    e.preventDefault();
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
    const { count, thieu } = applyRows(lines);
    toast.ok(`Đã dán ${count} dòng.` + (thieu ? ` ${thieu} dòng còn thiếu Ngày / Tiết / Lớp — điền nốt giúp.` : ''));
  }, [applyRows, toast]);

  const onImport = useCallback((data) => {
    const { count, thieu } = applyRows(data);
    if (thieu) toast.info(`${thieu}/${count} dòng còn thiếu Ngày / Tiết / Lớp — điền nốt trước khi tạo.`, 6000);
  }, [applyRows, toast]);

  const validCount = useMemo(
    () => rows.filter((r) => r.session_date && r.period && r.class_id).length,
    [rows]
  );

  const submit = async () => {
    if (!schoolId) { toast.err('Chọn trường trước đã.'); return; }
    const payload = rows
      .filter((r) => r.session_date && r.period && r.class_id)
      .map((r) => ({
        school_id: schoolId,
        session_date: r.session_date,
        period: Number(r.period),
        class_id: r.class_id,
        teacher_id: r.teacher_id || undefined,
        assistant_id: r.assistant_id || undefined,
        // Người chưa có tài khoản: gửi tên gõ tay để vẫn ghi được vào buổi dạy.
        teacher_manual_name: !r.teacher_id && r.teacher_text ? r.teacher_text : undefined,
        assistant_manual_name: !r.assistant_id && r.assistant_text ? r.assistant_text : undefined,
        room_id: r.room_id || undefined,
        subject: r.subject?.trim() || undefined,
      }));
    if (!payload.length) { toast.err('Chưa có dòng nào điền đủ Ngày, Tiết và Lớp.'); return; }

    setBusy(true);
    try {
      const out = await api.post('/api/schedules/batch', { rows: payload });
      setResult(out);
      if (out.created) toast.ok(`Đã tạo ${out.created} buổi dạy.`);
      if (!out.skipped?.length) {
        setRows([emptyRow()]);
        onDone(true);
      } else {
        onDone(false);   // nạp lại danh sách nhưng giữ bảng để sửa dòng lỗi
      }
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  /** Nhãn tiết kèm giờ của trường: "Tiết 3 · 08:40–09:25". */
  const periodLabel = (p) => `Tiết ${p.no}${p.start ? ` · ${p.start}–${p.end}` : ''}`;
  const cell = 'input !py-1.5 !px-2 text-sm';

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide title="Nhập lịch dạy dạng bảng">
      <div className="flex flex-wrap items-start gap-3 rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 mb-3 text-sm text-brand-900">
        <div className="flex-1 min-w-[260px]">
          💡 Chọn trường một lần, rồi điền từng dòng. Có sẵn lịch trong Excel thì tải tệp mẫu về,
          điền xong bấm <b>Tải tệp đã điền</b> — hoặc bôi đen vùng ô, copy và bấm <b>Ctrl+V</b> ngay trên bảng.
          Thứ tự cột: <b>Ngày · Tiết · Lớp · Giáo viên · Trợ giảng · Phòng · Nội dung</b>.
          Giáo viên / trợ giảng chưa có tài khoản thì cứ gõ tên.
        </div>
        <div className="flex flex-wrap gap-2">
          <TemplateButton path="/api/schedules/batch-template" name="mau-nhap-lich-day.xlsx" />
          <ImportButton kind="schedules" onRows={onImport} disabled={!schoolId} />
        </div>
      </div>

      <Field label="Trường" required hint={!schoolId ? 'Chọn trường trước rồi mới tải tệp lên được.' : undefined}>
        <select className="input" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
          <option value="">— Chọn trường —</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.classes_count ? ` (${s.classes_count} lớp)` : ''}
            </option>
          ))}
        </select>
      </Field>

      {schoolId && loadingRes && (
        <div className="flex items-center gap-2 text-sm text-ink-muted py-2">
          <Spinner className="h-4 w-4" /> Đang tải lớp, nhân sự và khung tiết của trường…
        </div>
      )}

      {schoolId && !loadingRes && (
        <>
          {/* Danh sách gợi ý tên người — gõ tay vẫn nhận nếu chưa có tài khoản */}
          <datalist id="dl-teachers">
            {res.teachers.map((u) => <option key={u.id} value={u.full_name} />)}
          </datalist>
          <datalist id="dl-assistants">
            {res.assistants.map((u) => <option key={u.id} value={u.full_name} />)}
          </datalist>

          <div className="hidden md:block overflow-x-auto -mx-1 px-1" onPaste={onPaste}>
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="th !w-8">#</th>
                  <th className="th !w-[130px]">Ngày *</th>
                  <th className="th !w-[150px]">Tiết *</th>
                  <th className="th">Lớp *</th>
                  <th className="th">Giáo viên</th>
                  <th className="th">Trợ giảng</th>
                  <th className="th">Phòng</th>
                  <th className="th">Nội dung</th>
                  <th className="th !w-[70px]"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const thieu = !r.session_date || !r.period || !r.class_id;
                  return (
                    <tr key={i} className={thieu ? 'bg-amber-50/40' : ''}>
                      <td className="td text-center text-ink-muted text-xs">{i + 1}</td>
                      <td className="td !p-1">
                        <input type="date" className={cell}
                          value={r.session_date} onChange={(e) => setCell(i, 'session_date', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <select className={cell} value={r.period}
                          onChange={(e) => setCell(i, 'period', e.target.value)}>
                          <option value="">— Chọn tiết —</option>
                          {periods.map((p) => (
                            <option key={p.no} value={p.no}>{periodLabel(p)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <select className={cell}
                          value={r.class_id} onChange={(e) => setCell(i, 'class_id', e.target.value)}>
                          <option value="">—</option>
                          {res.classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}{c.grade ? ` (K${c.grade})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <input className={`${cell} ${r.teacher_text && !r.teacher_id ? '!border-amber-400 bg-amber-50/60' : ''}`}
                          list="dl-teachers" placeholder="Chọn hoặc gõ tên"
                          value={r.teacher_text} onChange={(e) => setPerson(i, 'teacher', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <input className={`${cell} ${r.assistant_text && !r.assistant_id ? '!border-amber-400 bg-amber-50/60' : ''}`}
                          list="dl-assistants" placeholder="Chọn hoặc gõ tên"
                          value={r.assistant_text} onChange={(e) => setPerson(i, 'assistant', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <select className={cell}
                          value={r.room_id} onChange={(e) => setCell(i, 'room_id', e.target.value)}>
                          <option value="">—</option>
                          {res.rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <input className={cell} placeholder="Robotics — Bài 5"
                          value={r.subject} onChange={(e) => setCell(i, 'subject', e.target.value)} />
                      </td>
                      <td className="td !p-1 whitespace-nowrap text-center">
                        <button type="button" title="Nhân đôi dòng" aria-label="Nhân đôi dòng"
                          className="px-1.5 text-brand-600 hover:text-brand-900" onClick={() => dupRow(i)}>⧉</button>
                        <button type="button" title="Xoá dòng" aria-label="Xoá dòng"
                          className="px-1.5 text-rose-500 hover:text-rose-700" onClick={() => delRow(i)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Điện thoại: mỗi dòng một thẻ, các ô xếp dọc — cùng state với bảng ở trên. */}
          <div className="md:hidden grid gap-3">
            {rows.map((r, i) => {
              const thieu = !r.session_date || !r.period || !r.class_id;
              return (
                <div key={i} className={`card p-3.5 ${thieu ? '!border-amber-300 bg-amber-50/40' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                      Dòng {i + 1}{thieu ? ' · còn thiếu' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <button type="button" title="Nhân đôi dòng" aria-label="Nhân đôi dòng"
                        className="icon-btn text-brand-700 hover:bg-brand-50" onClick={() => dupRow(i)}>⧉</button>
                      <button type="button" title="Xoá dòng" aria-label="Xoá dòng"
                        className="icon-btn text-rose-600 hover:bg-rose-50" onClick={() => delRow(i)}>✕</button>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Ngày" required>
                      <input type="date" className="input" value={r.session_date}
                        onChange={(e) => setCell(i, 'session_date', e.target.value)} />
                    </Field>
                    <Field label="Tiết" required>
                      <select className="input" value={r.period} onChange={(e) => setCell(i, 'period', e.target.value)}>
                        <option value="">— Chọn —</option>
                        {periods.map((p) => <option key={p.no} value={p.no}>{periodLabel(p)}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Lớp" required>
                    <select className="input" value={r.class_id}
                      onChange={(e) => setCell(i, 'class_id', e.target.value)}>
                      <option value="">— Chọn lớp —</option>
                      {res.classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.grade ? ` (K${c.grade})` : ''}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Giáo viên" hint="Chưa có tài khoản thì cứ gõ tên.">
                    <input className="input" list="dl-teachers" placeholder="Chọn hoặc gõ tên"
                      value={r.teacher_text} onChange={(e) => setPerson(i, 'teacher', e.target.value)} />
                  </Field>
                  <Field label="Trợ giảng" hint="Chưa có tài khoản thì cứ gõ tên.">
                    <input className="input" list="dl-assistants" placeholder="Chọn hoặc gõ tên"
                      value={r.assistant_text} onChange={(e) => setPerson(i, 'assistant', e.target.value)} />
                  </Field>
                  <Field label="Phòng">
                    <select className="input" value={r.room_id}
                      onChange={(e) => setCell(i, 'room_id', e.target.value)}>
                      <option value="">— Chưa chọn —</option>
                      {res.rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Nội dung">
                    <input className="input" placeholder="Robotics — Bài 5" value={r.subject}
                      onChange={(e) => setCell(i, 'subject', e.target.value)} />
                  </Field>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button type="button" className="btn-line !py-2" onClick={addRow}>+ Thêm dòng</button>
            <span className="text-sm text-ink-muted">
              <b>{validCount}</b>/{rows.length} dòng đủ thông tin
            </span>
          </div>

          {result?.skipped?.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 mt-3">
              <div className="font-bold text-sm text-amber-900 mb-1.5">
                Đã tạo {result.created} buổi · {result.skipped.length} dòng bị bỏ qua:
              </div>
              <ul className="text-sm text-amber-900 grid gap-1 max-h-40 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <li key={i}>• Dòng {s.row}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions flex gap-2.5 justify-end mt-4">
            <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Đóng</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || !validCount}>
              {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                : `Tạo ${validCount} buổi dạy`}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
