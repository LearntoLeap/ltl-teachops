/**
 * ScheduleList.jsx — Lịch dạy: xem theo tuần/tháng, nhóm theo ngày.
 * - Giáo viên/Trợ giảng: chỉ thấy lịch của mình (API tự giới hạn phạm vi).
 * - Admin/Phòng chuyên môn: lọc theo trường, thêm buổi lẻ, sinh lịch lặp tuần,
 *   sửa hoặc huỷ buổi (huỷ bắt buộc nhập lý do).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDate, fmtDateLong, fmtRange, fmtTime, LABEL, monthRange, today } from '../../lib/format.js';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field,
  PageHeader, PageLoading, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import BatchEntry from './BatchEntry.jsx';

/* -------------------------------- Tiện ích -------------------------------- */

/** Phản hồi danh sách có thể là mảng hoặc {items:[]} theo quy ước phân trang. */
const listOf = (r) => (Array.isArray(r) ? r : r?.items || []);

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Thứ Hai → Chủ nhật của tuần hiện tại (offsetWeeks=1: tuần sau). */
function weekRange(offsetWeeks = 0) {
  const base = new Date(`${today()}T00:00:00`);
  const mon = new Date(base);
  mon.setDate(base.getDate() - ((base.getDay() + 6) % 7) + offsetWeeks * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: isoOf(mon), to: isoOf(sun) };
}

/** Tông màu badge theo trạng thái buổi dạy. */
const STATUS_TONE = { scheduled: 'neutral', done: 'approved', cancelled: 'absent' };

/** Server nhận weekdays theo ISO-8601: 1 = Thứ Hai … 7 = Chủ nhật. */
const WEEKDAY_OPTS = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' },
  { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' },
  { value: 7, label: 'CN' },
];

/* Server có thể trả tên phẳng (class_name) hoặc lồng (class:{name}) — đọc cả hai. */
const classNameOf = (s) => s.class_name || s.class?.name || '';
const schoolNameOf = (s) => s.school_name || s.school?.name || '';
const roomNameOf = (s) => s.room_name || s.room?.name || '';
const teacherNameOf = (s) => s.teacher_name || s.teacher?.full_name || '';
const assistantNameOf = (s) => s.assistant_name || s.assistant?.full_name || '';

function skippedLabel(s) {
  if (typeof s === 'string') return s;
  const d = (s?.session_date || s?.date) ? fmtDate(s.session_date || s.date) : '';
  const r = s?.reason || s?.message || 'Trùng lịch';
  return d ? `${d} — ${r}` : r;
}

/* --------------------- Nạp lớp/phòng/GV/TG theo trường --------------------- */
const EMPTY_RES = { classes: [], rooms: [], teachers: [], assistants: [], loading: false };

function useSchoolResources(schoolId, { light = false } = {}) {
  const toast = useToast();
  const [res, setRes] = useState(EMPTY_RES);

  useEffect(() => {
    if (!schoolId) { setRes(EMPTY_RES); return undefined; }
    let alive = true;
    setRes((s) => ({ ...s, loading: true }));
    Promise.all([
      api.get('/api/classes', { school_id: schoolId, limit: 200 }),
      api.get('/api/rooms', { school_id: schoolId, limit: 200 }),
      // GV/TG không có quyền xem danh bạ — buổi tự gắn chính họ
      light ? Promise.resolve([]) : api.get('/api/users', { role: 'teacher', school_id: schoolId, limit: 200 }),
      light ? Promise.resolve([]) : api.get('/api/users', { role: 'assistant', school_id: schoolId, limit: 200 }),
    ]).then(([c, r, t, a]) => {
      if (!alive) return;
      setRes({ classes: listOf(c), rooms: listOf(r), teachers: listOf(t), assistants: listOf(a), loading: false });
    }).catch((e) => {
      if (!alive) return;
      setRes((s) => ({ ...s, loading: false }));
      toast.fromError(e);
    });
    return () => { alive = false; };
  }, [schoolId, light, toast]);

  return res;
}

/* ------------------------------ Thành phần nhỏ ----------------------------- */

/** Chấm tròn trạng thái đã chấm công / đã điểm danh. */
function Dot({ on, label }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"
      title={`${on ? 'Đã' : 'Chưa'} ${label.toLowerCase()}`}>
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      {label}
    </span>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-line/60 last:border-0 text-[13.5px]">
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className="text-right font-medium min-w-0">{children}</span>
    </div>
  );
}

/** Thẻ một buổi dạy trong danh sách. */
function ScheduleCard({ s, onOpen }) {
  const cancelled = s.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`card w-full text-left p-3.5 transition hover:border-brand-300 ${cancelled ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-bold text-[15px] ${cancelled ? 'line-through text-ink-muted' : 'text-brand-800'}`}>
          {fmtRange(s.start_time, s.end_time)}
        </span>
        <span className="flex items-center gap-1.5">
          {s.self_added && (
            <Badge tone="pending" title="Giáo viên tự thêm buổi bị thiếu — nên rà soát">
              ✋ GV tự thêm
            </Badge>
          )}
          <Badge tone={STATUS_TONE[s.status] || 'neutral'}>
            {LABEL.scheduleStatus[s.status] || s.status || '—'}
          </Badge>
        </span>
      </div>
      <div className="font-semibold text-[14px] mt-1 truncate">
        {classNameOf(s) || 'Lớp ?'}{schoolNameOf(s) ? ` · ${schoolNameOf(s)}` : ''}
      </div>
      <div className="text-[12.5px] text-ink-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {teacherNameOf(s) && <span>GV: {teacherNameOf(s)}</span>}
        {assistantNameOf(s) && <span>TG: {assistantNameOf(s)}</span>}
        {roomNameOf(s) && <span>Phòng: {roomNameOf(s)}</span>}
        {s.subject && <span>📘 {s.subject}</span>}
      </div>
      <div className="flex items-center gap-4 mt-1.5">
        <Dot on={!!s.has_timesheet} label="Chấm công" />
        <Dot on={!!s.has_attendance} label="Điểm danh" />
      </div>
    </button>
  );
}

/* ------------------------- Thời khoá biểu tuần (bảng) ----------------------- */
/**
 * WeekTimetable — bảng thời khoá biểu quen thuộc với nhà trường:
 * cột = Thứ Hai…Chủ nhật, hàng = khung giờ (tự sinh từ các buổi thực tế trong tuần).
 * Mỗi ô hiện lớp · trường · GV. Ô trống bấm được để thêm buổi vào đúng ngày+giờ.
 */
function WeekTimetable({ from, items, onOpen, onAddSlot }) {
  const todayIso = today();

  // 7 ngày của tuần, bắt đầu từ Thứ Hai.
  const days = useMemo(() => {
    const base = new Date(`${from}T00:00:00`);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return { iso: isoOf(d), label: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][i], dayNum: d.getDate() };
    });
  }, [from]);

  // Khung giờ = tập hợp giờ bắt đầu xuất hiện trong tuần (sắp xếp tăng dần).
  const slots = useMemo(() => {
    const set = new Set();
    for (const s of items || []) {
      if (s.status === 'cancelled') continue;
      set.add(String(s.start_time).slice(0, 5));
    }
    // Chưa có buổi nào ⇒ dựng khung giờ mặc định để vẫn xếp được lịch.
    if (!set.size) ['07:30', '09:00', '14:00', '15:30'].forEach((t) => set.add(t));
    return [...set].sort();
  }, [items]);

  // Tra cứu nhanh: 'ngày|giờ' → danh sách buổi.
  const cellMap = useMemo(() => {
    const m = new Map();
    for (const s of items || []) {
      const k = `${String(s.session_date || s.date || '').slice(0, 10)}|${String(s.start_time).slice(0, 5)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return m;
  }, [items]);

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse">
          <thead>
            <tr>
              <th className="th !w-[86px] sticky left-0 z-10 bg-brand-50">Khung giờ</th>
              {days.map((d) => (
                <th key={d.iso}
                  className={`th text-center ${d.iso === todayIso ? '!bg-brand-100 !text-brand-900' : ''}`}>
                  {d.label}
                  <span className="block font-normal text-[11px] opacity-70">{fmtDate(d.iso).slice(0, 5)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((t) => (
              <tr key={t}>
                <td className="td !py-2 sticky left-0 z-10 bg-white font-bold text-brand-800 text-center whitespace-nowrap">
                  {t}
                </td>
                {days.map((d) => {
                  const list = cellMap.get(`${d.iso}|${t}`) || [];
                  return (
                    <td key={d.iso + t}
                      onClick={() => { if (onAddSlot && !list.length) onAddSlot(d.iso, t); }}
                      className={`td !p-1 align-top ${d.iso === todayIso ? 'bg-brand-50/40' : ''}
                        ${onAddSlot && !list.length ? 'cursor-pointer hover:bg-brand-50/70' : ''}`}>
                      {list.length === 0 ? (
                        <span className="block text-center text-[11px] text-ink-muted/50 py-2">
                          {onAddSlot ? '+' : '–'}
                        </span>
                      ) : list.map((sItem) => (
                        <button
                          key={sItem.id}
                          onClick={(e) => { e.stopPropagation(); onOpen(sItem); }}
                          className={`w-full text-left rounded-lg px-2 py-1.5 mb-1 last:mb-0 transition
                            ${sItem.status === 'cancelled'
                              ? 'bg-slate-100 text-slate-400 line-through'
                              : 'bg-brand-50 ring-1 ring-inset ring-brand-200 hover:bg-brand-100'}`}>
                          <span className="block text-[12px] font-bold text-brand-900 truncate">
                            {classNameOf(sItem)}
                          </span>
                          <span className="block text-[10.5px] text-ink-muted truncate">
                            {schoolNameOf(sItem)}
                          </span>
                          {teacherNameOf(sItem) && (
                            <span className="block text-[10px] text-ink-muted truncate">
                              {teacherNameOf(sItem)}
                            </span>
                          )}
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 text-[11px] text-ink-muted bg-canvas/60 border-t border-line">
        Bấm buổi để xem chi tiết{onAddSlot ? ' · bấm ô trống để xếp buổi vào đúng ngày và khung giờ đó' : ''}
      </div>
    </div>
  );
}

/* --------------------------- Lưới lịch tháng trực quan ---------------------- */
/**
 * MonthGrid — bảng tháng 7 cột: mỗi ô ngày hiện tối đa 3 buổi dạng chip
 * (giờ · lớp · trường · GV). Bấm chip → chi tiết; bấm vùng trống của ô
 * (nếu có quyền sắp lịch) → thêm buổi cho đúng ngày đó.
 */
function MonthGrid({ anchor, items, onOpen, onAddDay }) {
  const todayIso = today();
  const y = anchor.getFullYear();
  const m = anchor.getMonth();

  const cells = useMemo(() => {
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // lùi về Thứ Hai
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ date: isoOf(d), inMonth: d.getMonth() === m, dayNum: d.getDate() });
    }
    // Bỏ tuần cuối nếu toàn ngày tháng sau
    return out.slice(35).every((c) => !c.inMonth) ? out.slice(0, 35) : out;
  }, [y, m]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const s of items || []) {
      const d = String(s.session_date || s.date || '').slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    }
    return map;
  }, [items]);

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-brand-50/60">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-brand-900">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c) => {
          const list = byDay.get(c.date) || [];
          const extra = list.length - 3;
          const isToday = c.date === todayIso;
          return (
            <div
              key={c.date}
              onClick={() => { if (onAddDay && !list.length) onAddDay(c.date); }}
              className={`min-h-[92px] lg:min-h-[104px] border-b border-r border-line/70 p-1 lg:p-1.5 align-top
                ${c.inMonth ? 'bg-white' : 'bg-canvas/70'}
                ${onAddDay ? 'cursor-pointer hover:bg-brand-50/40' : ''}`}>
              <div className="flex items-center justify-between px-0.5">
                <span className={`text-[11.5px] font-bold h-5 w-5 grid place-items-center rounded-full
                  ${isToday ? 'bg-brand-grad text-white' : c.inMonth ? 'text-ink-soft' : 'text-ink-muted/50'}`}>
                  {c.dayNum}
                </span>
                {onAddDay && list.length > 0 && (
                  <button
                    className="text-[12px] text-brand-500 hover:text-brand-800 leading-none px-1"
                    title="Thêm buổi ngày này"
                    onClick={(e) => { e.stopPropagation(); onAddDay(c.date); }}>+</button>
                )}
              </div>
              <div className="mt-0.5 grid gap-[3px]">
                {list.slice(0, 3).map((sItem) => (
                  <button
                    key={sItem.id}
                    onClick={(e) => { e.stopPropagation(); onOpen(sItem); }}
                    title={`${fmtTime(sItem.start_time)} · Lớp ${classNameOf(sItem)} — ${schoolNameOf(sItem)}${teacherNameOf(sItem) ? ' · GV ' + teacherNameOf(sItem) : ''}`}
                    className={`w-full text-left rounded-md px-1.5 py-[3px] text-[10.5px] leading-tight font-semibold truncate transition
                      ${sItem.status === 'cancelled'
                        ? 'bg-slate-100 text-slate-400 line-through'
                        : 'bg-brand-50 text-brand-900 hover:bg-brand-100 ring-1 ring-inset ring-brand-100'}`}>
                    {fmtTime(sItem.start_time)} {classNameOf(sItem)}
                    <span className="font-normal text-brand-700/80"> · {schoolNameOf(sItem)}</span>
                    {teacherNameOf(sItem) && (
                      <span className="font-normal text-ink-muted"> · {teacherNameOf(sItem).split(' ').slice(-2).join(' ')}</span>
                    )}
                  </button>
                ))}
                {extra > 0 && (
                  <div className="text-[10px] text-ink-muted px-1">+{extra} buổi khác</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 text-[11px] text-ink-muted bg-canvas/60 border-t border-line">
        Bấm vào buổi để xem chi tiết · bấm ô ngày trống để thêm buổi mới
      </div>
    </div>
  );
}

/* ----------------------- Form thêm / sửa / lịch lặp tuần -------------------- */
/**
 * bulk=false + schedule=null  → thêm một buổi (POST /api/schedules)
 * bulk=false + schedule       → sửa buổi (PATCH /api/schedules/:id)
 * bulk=true                   → lịch lặp tuần (POST /api/schedules/bulk)
 */
function ScheduleForm({ bulk = false, schedule = null, initialDate = null, initialStart = null, selfOnly = false, schools, onSaved, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(null);
  const [f, setF] = useState(() => ({
    school_id: schedule?.school_id || (schools.length === 1 ? schools[0].id : ''),
    class_id: schedule?.class_id || '',
    room_id: schedule?.room_id || '',
    teacher_id: schedule?.teacher_id || '',
    assistant_id: schedule?.assistant_id || '',
    date: schedule?.session_date ? String(schedule.session_date).slice(0, 10) : (initialDate || today()),
    start_time: schedule ? fmtTime(schedule.start_time) : (initialStart || ''),
    end_time: schedule ? fmtTime(schedule.end_time) : '',
    subject: schedule?.subject || '',
    note: schedule?.note || '',
    weekdays: [],
    from: today(),
    to: '',
  }));

  const res = useSchoolResources(f.school_id, { light: selfOnly });

  const setField = (k) => (e) => {
    const v = e.target.value;
    setF((s) => (k === 'school_id'
      ? { ...s, school_id: v, class_id: '', room_id: '', teacher_id: '', assistant_id: '' }
      : { ...s, [k]: v }));
  };

  const toggleWeekday = (n) => setF((s) => ({
    ...s,
    weekdays: s.weekdays.includes(n) ? s.weekdays.filter((x) => x !== n) : [...s.weekdays, n],
  }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const need = [];
    if (!f.school_id) need.push('trường');
    if (!f.class_id) need.push('lớp');
    if (!selfOnly && !f.teacher_id) need.push('giáo viên');
    if (bulk) {
      if (!f.weekdays.length) need.push('thứ trong tuần');
      if (!f.from) need.push('từ ngày');
      if (!f.to) need.push('đến ngày');
    } else if (!f.date) need.push('ngày');
    if (!f.start_time) need.push('giờ bắt đầu');
    if (!f.end_time) need.push('giờ kết thúc');
    if (need.length) { toast.err(`Vui lòng chọn/nhập: ${need.join(', ')}.`); return; }
    if (f.end_time <= f.start_time) { toast.err('Giờ kết thúc phải sau giờ bắt đầu.'); return; }
    if (bulk && f.to < f.from) { toast.err('"Đến ngày" phải sau hoặc bằng "Từ ngày".'); return; }

    const template = {
      school_id: f.school_id,
      class_id: f.class_id,
      room_id: f.room_id || undefined,
      teacher_id: f.teacher_id,
      assistant_id: f.assistant_id || undefined,
      start_time: f.start_time,
      end_time: f.end_time,
      subject: f.subject.trim() || undefined,
      note: f.note.trim() || undefined,
    };

    setBusy(true);
    try {
      if (bulk) {
        // Server nhận body PHẲNG (docs/API.md §4): các trường buổi + weekdays/from/to.
        const out = await api.post('/api/schedules/bulk', {
          ...template,
          weekdays: [...f.weekdays].sort((a, b) => a - b),
          from: f.from,
          to: f.to,
        });
        const created = out?.created ?? 0;
        const sk = out?.skipped || [];
        if (sk.length) {
          toast.ok(`Đã tạo ${created} buổi · bỏ qua ${sk.length} buổi.`);
          setSkipped(sk);
          onSaved(false); // nạp lại danh sách nhưng giữ sheet để xem các buổi bị bỏ qua
        } else {
          toast.ok(`Đã tạo ${created} buổi.`);
          onSaved(true);
        }
      } else if (schedule) {
        await api.patch(`/api/schedules/${schedule.id}`, { ...template, session_date: f.date });
        toast.ok('Đã cập nhật buổi dạy.');
        onSaved(true);
      } else {
        await api.post('/api/schedules', { ...template, session_date: f.date });
        toast.ok('Đã thêm buổi dạy.');
        onSaved(true);
      }
    } catch (err) {
      // 409 trùng lịch: hiển thị nguyên văn message từ server.
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  /* Kết quả lịch lặp có buổi bị bỏ qua → thay form bằng danh sách bỏ qua. */
  if (skipped) {
    return (
      <div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <div className="text-[13.5px] font-bold text-amber-800 mb-2">
            ⚠ {skipped.length} buổi bị bỏ qua (trùng lịch hoặc không hợp lệ):
          </div>
          <ul className="text-[13px] text-amber-800 space-y-1 max-h-48 overflow-y-auto">
            {skipped.map((s, i) => <li key={i}>• {skippedLabel(s)}</li>)}
          </ul>
        </div>
        <button type="button" className="btn-primary w-full mt-4" onClick={onClose}>Đã hiểu, đóng</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Trường" required>
        <select className="input" value={f.school_id} onChange={setField('school_id')}>
          <option value="">— Chọn trường —</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Field label="Lớp" required>
          <select className="input" value={f.class_id} onChange={setField('class_id')} disabled={!f.school_id || res.loading}>
            <option value="">{res.loading ? 'Đang tải…' : '— Chọn lớp —'}</option>
            {res.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.grade ? ` — Khối ${c.grade}` : ''}
                {c.roster_size ? ` (${c.roster_size} HS)` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phòng">
          <select className="input" value={f.room_id} onChange={setField('room_id')} disabled={!f.school_id || res.loading}>
            <option value="">— Không chọn —</option>
            {res.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>

      {selfOnly && (
        <div className="rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-[13px] px-3.5 py-2.5 mb-3.5">
          ℹ️ Buổi này sẽ tự gắn tên bạn làm người phụ trách.
        </div>
      )}

      {/* Danh sách của trường đang chọn — để người sắp lịch nắm ngay nguồn lực */}
      {!selfOnly && f.school_id && !res.loading && (
        <div className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3.5 grid gap-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            Nguồn lực của trường này
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <span>🎓 <b>{res.classes.length}</b> lớp</span>
            <span>🤖 <b>{res.rooms.length}</b> phòng STEM</span>
            <span>🧑‍🏫 <b>{res.teachers.length}</b> giáo viên</span>
            <span>🤝 <b>{res.assistants.length}</b> trợ giảng</span>
          </div>
          {res.classes.length > 0 && (
            <div className="text-[11.5px] text-ink-muted">
              Lớp: {res.classes.slice(0, 8).map((c) => c.name).join(', ')}
              {res.classes.length > 8 ? ` … +${res.classes.length - 8}` : ''}
            </div>
          )}
        </div>
      )}

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-3 ${selfOnly ? 'hidden' : ''}`}>
        <Field label="Giáo viên" required={!selfOnly}>
          <select className="input" value={f.teacher_id} onChange={setField('teacher_id')} disabled={!f.school_id || res.loading}>
            <option value="">{res.loading ? 'Đang tải…' : '— Chọn giáo viên —'}</option>
            {res.teachers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.name}{u.region_name ? ` — ${u.region_name}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trợ giảng">
          <select className="input" value={f.assistant_id} onChange={setField('assistant_id')} disabled={!f.school_id || res.loading}>
            <option value="">— Không chọn —</option>
            {res.assistants.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.name}{u.region_name ? ` — ${u.region_name}` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {bulk ? (
        <>
          <Field label="Lặp vào các thứ" required>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTS.map((w) => {
                const on = f.weekdays.includes(w.value);
                return (
                  <label
                    key={w.value}
                    className={`px-3.5 py-1.5 rounded-xl border text-[13px] font-semibold cursor-pointer select-none transition
                      ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-line text-ink-soft hover:border-brand-300'}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggleWeekday(w.value)}
                    />
                    {w.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Từ ngày" required>
              <input type="date" className="input" value={f.from} onChange={setField('from')} />
            </Field>
            <Field label="Đến ngày" required>
              <input type="date" className="input" value={f.to} onChange={setField('to')} />
            </Field>
          </div>
        </>
      ) : (
        <Field label="Ngày" required>
          <input type="date" className="input" value={f.date} onChange={setField('date')} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Giờ bắt đầu" required>
          <input type="time" className="input" value={f.start_time} onChange={setField('start_time')} />
        </Field>
        <Field label="Giờ kết thúc" required>
          <input type="time" className="input" value={f.end_time} onChange={setField('end_time')} />
        </Field>
      </div>

      <Field label="Môn / chủ đề">
        <input className="input" value={f.subject} onChange={setField('subject')} placeholder="VD: Robotics — Bài 5" />
      </Field>
      <Field label="Ghi chú">
        <textarea className="input" rows={2} value={f.note} onChange={setField('note')} placeholder="Ghi chú thêm (nếu có)…" />
      </Field>

      <div className="flex gap-2.5 justify-end mt-1">
        <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy
            ? <Spinner className="h-4 w-4 border-white/40 border-t-white" />
            : bulk ? 'Tạo lịch lặp' : schedule ? 'Lưu thay đổi' : 'Thêm buổi'}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------- Màn hình chính ----------------------------- */

export default function ScheduleList() {
  const auth = useAuth();
  const toast = useToast();
  const canManage = auth.can('schedule.manage');
  const showSchoolFilter = auth.isAdmin || auth.isManager;

  const [mode, setMode] = useState('week');       // week | next | month
  const [view, setView] = useState('list');       // list | tkb (thời khoá biểu tuần) | grid (lịch tháng)
  const [sortBy, setSortBy] = useState('time');   // time | school | teacher
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);   // 0 = tuần này, ±n tuần
  const [batchOpen, setBatchOpen] = useState(false);  // màn nhập bảng nhiều buổi
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState([]);

  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [detail, setDetail] = useState(null);      // buổi đang xem chi tiết
  const [formCfg, setFormCfg] = useState(null);    // {bulk} | {schedule} | {}
  const [formSeq, setFormSeq] = useState(0);       // key để mỗi lần mở là form mới

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const range = useMemo(() => {
    if (view === 'grid') return monthRange(monthAnchor);
    if (view === 'tkb') return weekRange(weekOffset);
    return mode === 'month' ? monthRange() : weekRange(mode === 'next' ? 1 : 0);
  }, [mode, view, monthAnchor, weekOffset]);

  /* Danh sách trường cho bộ lọc + form (chỉ admin/manager cần gọi). */
  const canSelfAdd = auth.can('schedule.selfCreate');
  useEffect(() => {
    if (!showSchoolFilter && !canManage && !canSelfAdd) return;
    api.get('/api/schools', { limit: 200 })
      .then((r) => setSchools(listOf(r)))
      .catch((e) => toast.fromError(e));
  }, [showSchoolFilter, canManage, canSelfAdd, toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/api/schedules', {
        from: range.from, to: range.to, school_id: schoolId, limit: 200,
      });
      setItems(listOf(r));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, schoolId]);

  useEffect(() => { load(); }, [load]);

  /* Nhóm theo ngày; trong ngày xếp theo lựa chọn "Sắp xếp". */
  const groups = useMemo(() => {
    const byTime = (x, y) => String(x.start_time).localeCompare(String(y.start_time));
    const cmp = {
      time: byTime,
      school: (x, y) => (schoolNameOf(x) || '').localeCompare(schoolNameOf(y) || '', 'vi') || byTime(x, y),
      teacher: (x, y) => (teacherNameOf(x) || '').localeCompare(teacherNameOf(y) || '', 'vi') || byTime(x, y),
    }[sortBy] || byTime;

    const m = new Map();
    for (const s of items || []) {
      const d = String(s.session_date || s.date || '').slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(s);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, list]) => [date, list.sort(cmp)]);
  }, [items, sortBy]);

  const openForm = (cfg) => { setFormSeq((n) => n + 1); setFormCfg(cfg); };

  const doCancel = async () => {
    if (!detail) return;
    if (!cancelReason.trim()) { toast.err('Vui lòng nhập lý do huỷ buổi.'); return; }
    setCancelBusy(true);
    try {
      // Server đọc lý do huỷ từ query ?reason= (DELETE không có body).
      await api.del(`/api/schedules/${detail.id}`, { query: { reason: cancelReason.trim() } });
      toast.ok('Đã huỷ buổi dạy.');
      setCancelOpen(false);
      setDetail(null);
      load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setCancelBusy(false);
    }
  };

  const todayIso = today();

  return (
    <div>
      <PageHeader
        title="Lịch dạy"
        sub={`${fmtDate(range.from)} – ${fmtDate(range.to)}${items ? ` · ${items.length} buổi` : ''}`}
        actions={canManage ? (
          <>
            <button className="btn-line" onClick={() => setBatchOpen(true)}>📋 Nhập bảng</button>
            <button className="btn-line" onClick={() => openForm({ bulk: true })}>+ Lịch lặp tuần</button>
            <button className="btn-primary" onClick={() => openForm({})}>+ Thêm buổi</button>
          </>
        ) : canSelfAdd ? (
          <button className="btn-primary" onClick={() => openForm({})}>+ Thêm buổi bị thiếu</button>
        ) : null}
      />

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Danh sách' },
            { value: 'tkb', label: '📅 Thời khoá biểu' },
            { value: 'grid', label: '🗓️ Lịch tháng' },
          ]}
        />
        {view === 'tkb' && (
          <div className="flex items-center gap-1.5">
            <button className="btn-line !px-3 !py-2" aria-label="Tuần trước"
              onClick={() => setWeekOffset((w) => w - 1)}>‹</button>
            <span className="font-bold text-[13px] text-brand-900 min-w-[150px] text-center">
              {fmtDate(range.from)} – {fmtDate(range.to)}
            </span>
            <button className="btn-line !px-3 !py-2" aria-label="Tuần sau"
              onClick={() => setWeekOffset((w) => w + 1)}>›</button>
            {weekOffset !== 0 && (
              <button className="btn-ghost !px-3 !py-2" onClick={() => setWeekOffset(0)}>Tuần này</button>
            )}
          </div>
        )}
        {view === 'list' && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'week', label: 'Tuần này' },
              { value: 'next', label: 'Tuần sau' },
              { value: 'month', label: 'Tháng này' },
            ]}
          />
        )}
        {view === 'list' && (
          <select
            className="input !w-auto !py-2"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sắp xếp trong ngày">
            <option value="time">Sắp xếp: theo giờ</option>
            <option value="school">Sắp xếp: theo trường</option>
            <option value="teacher">Sắp xếp: theo giáo viên</option>
          </select>
        )}
        {view === 'grid' && (
          <div className="flex items-center gap-1.5">
            <button className="btn-line !px-3 !py-2" aria-label="Tháng trước"
              onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
            <span className="font-bold text-[14px] text-brand-900 min-w-[110px] text-center">
              Tháng {monthAnchor.getMonth() + 1}/{monthAnchor.getFullYear()}
            </span>
            <button className="btn-line !px-3 !py-2" aria-label="Tháng sau"
              onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
            <button className="btn-ghost !px-3 !py-2" onClick={() => setMonthAnchor(new Date())}>Hôm nay</button>
          </div>
        )}
        {showSchoolFilter && (
          <select
            className="input !w-auto !py-2"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            aria-label="Lọc theo trường">
            <option value="">Tất cả trường</option>
            {schools.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}{sc.classes_count ? ` (${sc.classes_count} lớp)` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && !items && <PageLoading />}
      {!loading && error && <ErrorBox error={error} onRetry={load} />}

      {items && !error && view === 'tkb' && (
        <WeekTimetable
          from={range.from}
          items={items}
          onOpen={(sItem) => setDetail(sItem)}
          onAddSlot={(canManage || canSelfAdd) ? (d, t) => openForm({ date: d, start: t }) : null}
        />
      )}

      {items && !error && view === 'grid' && (
        <MonthGrid
          anchor={monthAnchor}
          items={items}
          onOpen={(sItem) => setDetail(sItem)}
          onAddDay={(canManage || canSelfAdd) ? (d) => openForm({ date: d }) : null}
        />
      )}

      {items && !error && view === 'list' && (
        <>
          {loading && <div className="flex justify-center py-1.5"><Spinner /></div>}

          {groups.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="Không có buổi dạy nào"
              hint={canManage
                ? 'Khoảng thời gian này chưa được xếp lịch. Thêm buổi lẻ hoặc tạo lịch lặp theo tuần.'
                : 'Bạn không có buổi dạy nào trong khoảng thời gian này.'}
              action={canManage ? (
                <button className="btn-primary" onClick={() => openForm({})}>+ Thêm buổi</button>
              ) : null}
            />
          ) : (
            groups.map(([date, list]) => (
              <section key={date} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[13.5px] font-bold text-brand-900">{fmtDateLong(date)}</h2>
                  {date === todayIso && (
                    <span className="badge bg-brand-50 text-brand-700 ring-brand-200">Hôm nay</span>
                  )}
                  <span className="text-[12px] text-ink-muted">{list.length} buổi</span>
                </div>
                <div className="grid gap-2.5">
                  {list.map((s) => (
                    <ScheduleCard key={s.id} s={s} onOpen={() => setDetail(s)} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}

      <BatchEntry
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        schools={schools}
        onDone={(close) => { load(); if (close) setBatchOpen(false); }}
      />

      {/* ------------------------- Chi tiết buổi dạy ------------------------- */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title="Chi tiết buổi dạy">
        {detail && (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[17px] font-bold text-brand-800">
                {fmtRange(detail.start_time, detail.end_time)}
              </div>
              <Badge tone={STATUS_TONE[detail.status] || 'neutral'}>
                {LABEL.scheduleStatus[detail.status] || detail.status || '—'}
              </Badge>
            </div>
            <div className="text-[13px] text-ink-muted mb-3">{fmtDateLong(detail.session_date || detail.date)}</div>

            <div className="card p-3.5 mb-4">
              <Row label="Nguồn">
                {detail.self_added
                  ? <span className="text-amber-700">✋ Giáo viên tự thêm</span>
                  : <span className="text-ink-muted">Phòng chuyên môn xếp lịch</span>}
              </Row>
              <Row label="Lớp">{classNameOf(detail) || '—'}</Row>
              <Row label="Trường">{schoolNameOf(detail) || '—'}</Row>
              <Row label="Phòng">{roomNameOf(detail) || '—'}</Row>
              <Row label="Giáo viên">{teacherNameOf(detail) || '—'}</Row>
              <Row label="Trợ giảng">{assistantNameOf(detail) || '—'}</Row>
              <Row label="Môn / chủ đề">{detail.subject || '—'}</Row>
              {detail.note ? <Row label="Ghi chú">{detail.note}</Row> : null}
              {detail.status === 'cancelled' && (detail.cancel_reason || detail.cancelled_reason) ? (
                <Row label="Lý do huỷ">{detail.cancel_reason || detail.cancelled_reason}</Row>
              ) : null}
            </div>

            <div className="flex items-center gap-4 mb-4">
              <Dot on={!!detail.has_timesheet} label="Chấm công" />
              <Dot on={!!detail.has_attendance} label="Điểm danh" />
            </div>

            {canManage && detail.status !== 'cancelled' && (
              <div className="flex gap-2.5">
                <button
                  className="btn-line flex-1"
                  onClick={() => { const s = detail; setDetail(null); openForm({ schedule: s }); }}>
                  ✏️ Sửa
                </button>
                <button
                  className="btn-danger flex-1"
                  onClick={() => { setCancelReason(''); setCancelOpen(true); }}>
                  Huỷ buổi
                </button>
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* ---------------------- Form thêm / sửa / lặp tuần -------------------- */}
      <Sheet
        open={!!formCfg}
        onClose={() => setFormCfg(null)}
        wide
        title={formCfg?.bulk ? 'Lịch lặp tuần' : formCfg?.schedule ? 'Sửa buổi dạy' : 'Thêm buổi dạy'}>
        {formCfg && (
          <ScheduleForm
            key={formSeq}
            bulk={!!formCfg.bulk}
            schedule={formCfg.schedule || null}
            initialDate={formCfg.date || null}
            initialStart={formCfg.start || null}
            selfOnly={!canManage}
            schools={schools}
            onSaved={(close) => { load(); if (close) setFormCfg(null); }}
            onClose={() => setFormCfg(null)}
          />
        )}
      </Sheet>

      {/* -------------------------- Xác nhận huỷ buổi ------------------------- */}
      <ConfirmSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={doCancel}
        title="Huỷ buổi dạy"
        danger
        confirmLabel="Huỷ buổi"
        busy={cancelBusy}
        message={detail ? (
          <>
            Buổi <b>{fmtRange(detail.start_time, detail.end_time)}</b> ngày <b>{fmtDate(detail.session_date || detail.date)}</b>
            {classNameOf(detail) ? <> — lớp <b>{classNameOf(detail)}</b></> : null} sẽ bị huỷ.
            <textarea
              className="input mt-3"
              rows={2}
              placeholder="Lý do huỷ (bắt buộc)…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </>
        ) : ''}
      />
    </div>
  );
}
