/**
 * BatchEntry.jsx — Nhập lịch dạy dạng BẢNG, cho Admin / Phòng chuyên môn.
 *
 * Mục đích: xếp lịch đầu kỳ thường là hàng chục buổi khác nhau (khác lớp, khác
 * giờ, khác giáo viên). Nhập từng buổi qua form quá chậm, nên màn hình này cho
 * điền thẳng trên lưới giống Excel:
 *   - Chọn trường một lần ở đầu → mọi dòng dùng chung, chỉ điền phần khác nhau.
 *   - Nút "Nhân đôi dòng" để lặp nhanh buổi tương tự.
 *   - DÁN TỪ EXCEL: copy vùng ô rồi Ctrl+V ngay trên bảng.
 *
 * Gửi lên POST /api/schedules/batch — dòng lỗi bị bỏ qua và báo rõ số dòng,
 * các dòng còn lại vẫn được tạo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { today } from '../../lib/format.js';
import { findByName } from '../../lib/tablePaste.js';

const listOf = (r) => (Array.isArray(r) ? r : r?.items || []);

/** Một dòng trống. Giữ giờ của dòng trước để điền tiếp cho nhanh. */
const emptyRow = (prev) => ({
  session_date: prev?.session_date || today(),
  start_time: prev?.start_time || '',
  end_time: prev?.end_time || '',
  class_id: '',
  teacher_id: prev?.teacher_id || '',
  assistant_id: prev?.assistant_id || '',
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

/** '8h', '8:00', '08.00', '0800' → '08:00'. */
function parseTime(v) {
  const s = String(v || '').trim().replace(/\s/g, '');
  if (!s) return '';
  let m = s.match(/^(\d{1,2})[:h.](\d{1,2})$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})h?$/i);
  if (m) return `${m[1].padStart(2, '0')}:00`;
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) return `${m[1]}:${m[2]}`;
  return s;
}

export default function BatchEntry({ open, onClose, schools, onDone }) {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [res, setRes] = useState({ classes: [], rooms: [], teachers: [], assistants: [] });
  const [loadingRes, setLoadingRes] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { created, skipped[] }

  // Chọn trường → nạp lớp / phòng / giáo viên / trợ giảng của trường đó
  useEffect(() => {
    if (!schoolId) { setRes({ classes: [], rooms: [], teachers: [], assistants: [] }); return undefined; }
    let alive = true;
    setLoadingRes(true);
    Promise.all([
      api.get('/api/classes', { school_id: schoolId, limit: 200 }),
      api.get('/api/rooms', { school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'teacher', school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'assistant', school_id: schoolId, limit: 200 }),
    ]).then(([c, r, t, a]) => {
      if (!alive) return;
      setRes({ classes: listOf(c), rooms: listOf(r), teachers: listOf(t), assistants: listOf(a) });
    }).catch((e) => { if (alive) toast.fromError(e); })
      .finally(() => { if (alive) setLoadingRes(false); });
    return () => { alive = false; };
  }, [schoolId, toast]);

  const setCell = (i, key, val) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const addRow = () => setRows((rs) => [...rs, emptyRow(rs[rs.length - 1])]);
  const dupRow = (i) => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i], class_id: '' }, ...rs.slice(i + 1)]);
  const delRow = (i) => setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));

  /**
   * Dán từ Excel: mỗi dòng một buổi, các cột cách nhau bằng Tab theo thứ tự
   * Ngày · Bắt đầu · Kết thúc · Lớp · Giáo viên · Trợ giảng · Phòng · Nội dung.
   * Tên lớp/người được dò gần đúng sang id.
   */
  const onPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !text.includes('\t')) return;     // dán 1 ô thì để trình duyệt xử lý
    e.preventDefault();

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const parsed = lines.map((line) => {
      const c = line.split('\t');
      return {
        session_date: parseDate(c[0]),
        start_time: parseTime(c[1]),
        end_time: parseTime(c[2]),
        class_id: findByName(res.classes, c[3]),
        teacher_id: findByName(res.teachers, c[4]),
        assistant_id: findByName(res.assistants, c[5]),
        room_id: findByName(res.rooms, c[6]),
        subject: (c[7] || '').trim(),
      };
    });
    setRows(parsed);
    const chuaKhop = parsed.filter((r) => !r.class_id).length;
    toast.ok(`Đã dán ${parsed.length} dòng.` + (chuaKhop ? ` ${chuaKhop} dòng chưa khớp tên lớp — chọn tay giúp.` : ''));
  }, [res, toast]);

  const validCount = useMemo(
    () => rows.filter((r) => r.session_date && r.start_time && r.end_time && r.class_id).length,
    [rows]
  );

  const submit = async () => {
    if (!schoolId) { toast.err('Chọn trường trước đã.'); return; }
    const payload = rows
      .filter((r) => r.session_date && r.start_time && r.end_time && r.class_id)
      .map((r) => ({
        school_id: schoolId,
        session_date: r.session_date,
        start_time: r.start_time,
        end_time: r.end_time,
        class_id: r.class_id,
        teacher_id: r.teacher_id || undefined,
        assistant_id: r.assistant_id || undefined,
        room_id: r.room_id || undefined,
        subject: r.subject?.trim() || undefined,
      }));
    if (!payload.length) { toast.err('Chưa có dòng nào điền đủ Ngày, Giờ và Lớp.'); return; }

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

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} wide title="Nhập lịch dạy dạng bảng">
      <div className="rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 mb-3 text-[12.5px] text-brand-900">
        💡 Chọn trường một lần, rồi điền từng dòng. Có sẵn lịch trong Excel thì bôi đen vùng ô,
        copy và bấm <b>Ctrl+V</b> ngay trên bảng — thứ tự cột:
        <b> Ngày · Bắt đầu · Kết thúc · Lớp · Giáo viên · Trợ giảng · Phòng · Nội dung</b>.
      </div>

      <Field label="Trường" required>
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
        <div className="flex items-center gap-2 text-[13px] text-ink-muted py-2">
          <Spinner className="h-4 w-4" /> Đang tải lớp và nhân sự của trường…
        </div>
      )}

      {schoolId && !loadingRes && (
        <>
          <div className="overflow-x-auto -mx-1 px-1" onPaste={onPaste}>
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="th !w-8">#</th>
                  <th className="th !w-[130px]">Ngày *</th>
                  <th className="th !w-[90px]">Bắt đầu *</th>
                  <th className="th !w-[90px]">Kết thúc *</th>
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
                  const thieu = !r.session_date || !r.start_time || !r.end_time || !r.class_id;
                  return (
                    <tr key={i} className={thieu ? 'bg-amber-50/40' : ''}>
                      <td className="td text-center text-ink-muted text-[12px]">{i + 1}</td>
                      <td className="td !p-1">
                        <input type="date" className="input !py-1.5 !px-2 text-[13px]"
                          value={r.session_date} onChange={(e) => setCell(i, 'session_date', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <input type="time" className="input !py-1.5 !px-2 text-[13px]"
                          value={r.start_time} onChange={(e) => setCell(i, 'start_time', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <input type="time" className="input !py-1.5 !px-2 text-[13px]"
                          value={r.end_time} onChange={(e) => setCell(i, 'end_time', e.target.value)} />
                      </td>
                      <td className="td !p-1">
                        <select className="input !py-1.5 !px-2 text-[13px]"
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
                        <select className="input !py-1.5 !px-2 text-[13px]"
                          value={r.teacher_id} onChange={(e) => setCell(i, 'teacher_id', e.target.value)}>
                          <option value="">—</option>
                          {res.teachers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <select className="input !py-1.5 !px-2 text-[13px]"
                          value={r.assistant_id} onChange={(e) => setCell(i, 'assistant_id', e.target.value)}>
                          <option value="">—</option>
                          {res.assistants.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <select className="input !py-1.5 !px-2 text-[13px]"
                          value={r.room_id} onChange={(e) => setCell(i, 'room_id', e.target.value)}>
                          <option value="">—</option>
                          {res.rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </td>
                      <td className="td !p-1">
                        <input className="input !py-1.5 !px-2 text-[13px]" placeholder="Robotics — Bài 5"
                          value={r.subject} onChange={(e) => setCell(i, 'subject', e.target.value)} />
                      </td>
                      <td className="td !p-1 whitespace-nowrap text-center">
                        <button type="button" title="Nhân đôi dòng"
                          className="px-1.5 text-brand-600 hover:text-brand-900" onClick={() => dupRow(i)}>⧉</button>
                        <button type="button" title="Xoá dòng"
                          className="px-1.5 text-rose-500 hover:text-rose-700" onClick={() => delRow(i)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button type="button" className="btn-line !py-2" onClick={addRow}>+ Thêm dòng</button>
            <span className="text-[12.5px] text-ink-muted">
              <b>{validCount}</b>/{rows.length} dòng đủ thông tin
            </span>
          </div>

          {result?.skipped?.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 mt-3">
              <div className="font-bold text-[13px] text-amber-900 mb-1.5">
                Đã tạo {result.created} buổi · {result.skipped.length} dòng bị bỏ qua:
              </div>
              <ul className="text-[12.5px] text-amber-900 grid gap-1 max-h-40 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <li key={i}>• Dòng {s.row}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2.5 justify-end mt-4">
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
