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

function useSchoolResources(schoolId) {
  const toast = useToast();
  const [res, setRes] = useState(EMPTY_RES);

  useEffect(() => {
    if (!schoolId) { setRes(EMPTY_RES); return undefined; }
    let alive = true;
    setRes((s) => ({ ...s, loading: true }));
    Promise.all([
      api.get('/api/classes', { school_id: schoolId, limit: 200 }),
      api.get('/api/rooms', { school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'teacher', school_id: schoolId, limit: 200 }),
      api.get('/api/users', { role: 'assistant', school_id: schoolId, limit: 200 }),
    ]).then(([c, r, t, a]) => {
      if (!alive) return;
      setRes({ classes: listOf(c), rooms: listOf(r), teachers: listOf(t), assistants: listOf(a), loading: false });
    }).catch((e) => {
      if (!alive) return;
      setRes((s) => ({ ...s, loading: false }));
      toast.fromError(e);
    });
    return () => { alive = false; };
  }, [schoolId, toast]);

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
        <Badge tone={STATUS_TONE[s.status] || 'neutral'}>
          {LABEL.scheduleStatus[s.status] || s.status || '—'}
        </Badge>
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

/* ----------------------- Form thêm / sửa / lịch lặp tuần -------------------- */
/**
 * bulk=false + schedule=null  → thêm một buổi (POST /api/schedules)
 * bulk=false + schedule       → sửa buổi (PATCH /api/schedules/:id)
 * bulk=true                   → lịch lặp tuần (POST /api/schedules/bulk)
 */
function ScheduleForm({ bulk = false, schedule = null, schools, onSaved, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(null);
  const [f, setF] = useState(() => ({
    school_id: schedule?.school_id || (schools.length === 1 ? schools[0].id : ''),
    class_id: schedule?.class_id || '',
    room_id: schedule?.room_id || '',
    teacher_id: schedule?.teacher_id || '',
    assistant_id: schedule?.assistant_id || '',
    date: schedule?.session_date ? String(schedule.session_date).slice(0, 10) : today(),
    start_time: schedule ? fmtTime(schedule.start_time) : '',
    end_time: schedule ? fmtTime(schedule.end_time) : '',
    subject: schedule?.subject || '',
    note: schedule?.note || '',
    weekdays: [],
    from: today(),
    to: '',
  }));

  const res = useSchoolResources(f.school_id);

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
    if (!f.teacher_id) need.push('giáo viên');
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
            {res.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Phòng">
          <select className="input" value={f.room_id} onChange={setField('room_id')} disabled={!f.school_id || res.loading}>
            <option value="">— Không chọn —</option>
            {res.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Field label="Giáo viên" required>
          <select className="input" value={f.teacher_id} onChange={setField('teacher_id')} disabled={!f.school_id || res.loading}>
            <option value="">{res.loading ? 'Đang tải…' : '— Chọn giáo viên —'}</option>
            {res.teachers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.name}</option>)}
          </select>
        </Field>
        <Field label="Trợ giảng">
          <select className="input" value={f.assistant_id} onChange={setField('assistant_id')} disabled={!f.school_id || res.loading}>
            <option value="">— Không chọn —</option>
            {res.assistants.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.name}</option>)}
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

  const range = useMemo(
    () => (mode === 'month' ? monthRange() : weekRange(mode === 'next' ? 1 : 0)),
    [mode],
  );

  /* Danh sách trường cho bộ lọc + form (chỉ admin/manager cần gọi). */
  useEffect(() => {
    if (!showSchoolFilter && !canManage) return;
    api.get('/api/schools', { limit: 200 })
      .then((r) => setSchools(listOf(r)))
      .catch((e) => toast.fromError(e));
  }, [showSchoolFilter, canManage, toast]);

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

  /* Nhóm theo ngày; trong ngày xếp theo giờ bắt đầu. */
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of items || []) {
      const d = String(s.session_date || s.date || '').slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(s);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, list]) => [
        date,
        list.sort((x, y) => String(x.start_time).localeCompare(String(y.start_time))),
      ]);
  }, [items]);

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
            <button className="btn-line" onClick={() => openForm({ bulk: true })}>+ Lịch lặp tuần</button>
            <button className="btn-primary" onClick={() => openForm({})}>+ Thêm buổi</button>
          </>
        ) : null}
      />

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Tuần này' },
            { value: 'next', label: 'Tuần sau' },
            { value: 'month', label: 'Tháng này' },
          ]}
        />
        {showSchoolFilter && (
          <select
            className="input !w-auto !py-2"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            aria-label="Lọc theo trường">
            <option value="">Tất cả trường</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {loading && !items && <PageLoading />}
      {!loading && error && <ErrorBox error={error} onRetry={load} />}

      {items && !error && (
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
