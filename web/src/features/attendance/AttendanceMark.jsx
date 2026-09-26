/**
 * AttendanceMark.jsx — Điểm danh một buổi dạy (/diem-danh/:scheduleId).
 *
 * - Thông tin trường/lớp/người dạy tự điền theo lịch phân công — chỉ hiển thị tĩnh.
 * - Giáo viên điền CẢ HAI số theo thực tế: có mặt / sĩ số ("26/30"), không giới
 *   hạn theo sĩ số chuẩn của lớp. Sĩ số gợi ý sẵn theo lần điểm danh gần nhất.
 * - Buổi đã điểm danh (cờ trên lịch hoặc server trả 409) → hiển thị bản ghi đã có.
 * - Mất mạng → đưa vào hàng đợi offline (enqueue), tự gửi lại khi có sóng.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDate, fmtDateLong, fmtDateTime, fmtRange } from '../../lib/format.js';
import { enqueue, isOnline } from '../../lib/offline.js';
import { Badge, ErrorBox, Field, PageHeader, PageLoading, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';

/** Chuẩn hoá phản hồi danh sách: mảng trần hoặc { items: [] }. */
const asItems = (res) => (Array.isArray(res) ? res : res?.items || []);

/** Danh sách id ảnh của một bản ghi — chịu được nhiều dạng dữ liệu trả về. */
function photoIds(rec) {
  const arr = rec?.photos || rec?.photo_ids || rec?.files || [];
  return arr.map((p) => (typeof p === 'object' ? p?.id || p?.file_id : p)).filter(Boolean);
}

/** Một dòng nhãn – giá trị trong thẻ thông tin. */
function InfoRow({ k, v }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-ink-muted">{k}</span>
      <span className="text-ink font-medium min-w-0">{v}</span>
    </div>
  );
}

/** Bản ghi điểm danh đã có — hiển thị khi buổi này đã được điểm danh. */
function RecordCard({ record, roster }) {
  const ids = photoIds(record);
  const markedBy = record.marked_by_name || record.marked_by?.full_name || '—';
  return (
    <div className="card p-4">
      <div className="font-bold text-lg mb-2.5">Bản ghi điểm danh</div>
      <div className="grid gap-1.5">
        <InfoRow k="Có mặt" v={`${record.present_count ?? '—'}/${record.roster_size ?? roster ?? '—'} học sinh`} />
        {record.absent_names && <InfoRow k="HS vắng" v={record.absent_names} />}
        {record.note && <InfoRow k="Ghi chú" v={record.note} />}
        <InfoRow k="Người điểm danh" v={markedBy} />
        <InfoRow k="Thời điểm" v={fmtDateTime(record.created_at || record.marked_at) || '—'} />
      </div>
      {ids.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
          {ids.map((id) => (
            <a
              key={id}
              href={fileUrl(id)}
              target="_blank"
              rel="noreferrer"
              className="block aspect-square rounded-xl overflow-hidden border border-line"
              title="Mở ảnh đầy đủ">
              <img src={fileUrl(id, { thumb: true })} alt="Ảnh điểm danh" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      <Link to="/diem-danh" className="btn-line w-full mt-4">Về màn hình Điểm danh</Link>
    </div>
  );
}

/** Ô số lớn có nút −/+ (bấm được trên điện thoại). Không giới hạn trên. */
function CountInput({ label, value, onChange, placeholder, tone = 'brand' }) {
  const n = value === '' || value === null ? null : Number(value);
  const step = (d) => onChange(String(Math.max(0, (n ?? 0) + d)));
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold text-ink-soft mb-1">{label} <span className="text-rose-500">*</span></div>
      <div className="flex items-stretch">
        <button type="button" onClick={() => step(-1)} aria-label={`Bớt ${label}`}
          className="w-10 rounded-l-lg border border-line text-xl text-ink-soft hover:bg-zinc-50">−</button>
        <input
          className={`h-12 min-w-0 w-full flex-1 border-y border-line text-center text-2xl font-extrabold tabular-nums outline-none
            focus:bg-brand-50 ${tone === 'brand' ? 'text-brand-800' : 'text-ink'}`}
          inputMode="numeric" value={value ?? ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
          aria-label={label} />
        <button type="button" onClick={() => step(1)} aria-label={`Thêm ${label}`}
          className="w-10 rounded-r-lg border border-line text-xl text-ink-soft hover:bg-zinc-50">+</button>
      </div>
    </div>
  );
}

export default function AttendanceMark() {
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();

  const [schedule, setSchedule] = useState(null);
  const [record, setRecord] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // Form
  const [present, setPresent] = useState('');     // giáo viên đếm thực tế
  const [total, setTotal] = useState(null);       // sĩ số buổi này; null = chưa nạp lịch
  const [absentNames, setAbsentNames] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  /** Tải bản ghi điểm danh đã có của buổi này (lọc theo schedule). */
  const fetchRecord = useCallback(async (s) => {
    try {
      const res = await api.get('/api/attendance', {
        schedule_id: scheduleId, from: s?.session_date, to: s?.session_date, limit: 50,
      });
      const rec = asItems(res).find((r) => String(r.schedule_id) === String(scheduleId)) || null;
      setRecord(rec);
    } catch {
      // Không tải được chi tiết vẫn hiển thị thông báo "đã điểm danh".
    }
  }, [scheduleId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api.get(`/api/schedules/${scheduleId}`);
      setSchedule(s);
      // Gợi ý sĩ số theo lần điểm danh gần nhất (hoặc sĩ số lớp) — giáo viên sửa theo thực tế.
      const hint = Number(s?.last_roster_size) || Number(s?.roster_size) || 0;
      setTotal((prev) => (prev === null ? (hint ? String(hint) : '') : prev));
      const attended = !!(s?.attendance_done ?? s?.has_attendance);
      setDone(attended);
      if (attended) await fetchRecord(s);
    } catch (e) {
      setError(e);
    }
  }, [scheduleId, fetchRecord]);

  useEffect(() => { load(); }, [load]);

  if (error && !schedule) return <ErrorBox error={error} onRetry={load} />;
  if (!schedule) return <PageLoading />;

  const roster = Number(schedule.last_roster_size || schedule.roster_size || 0);
  const teacherNames = schedule.teacher_name
    || (schedule.assignments || schedule.staff || []).map((a) => a.full_name || a.name).filter(Boolean).join(', ');
  const nPresent = present === '' ? null : Number(present);
  const nTotal = total === '' || total === null ? null : Number(total);
  const over = nPresent !== null && nTotal !== null && nPresent > nTotal;
  const missing = nPresent !== null && nTotal !== null && nPresent < nTotal ? nTotal - nPresent : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (nPresent === null || !Number.isFinite(nPresent)) {
      toast.err('Vui lòng điền số học sinh có mặt.');
      return;
    }
    if (nTotal === null || !Number.isFinite(nTotal)) {
      toast.err('Vui lòng điền sĩ số của buổi này.');
      return;
    }
    if (over) {
      toast.err(`Số có mặt (${nPresent}) lớn hơn sĩ số (${nTotal}) — vui lòng kiểm tra lại.`);
      return;
    }
    if (!photos.length) {
      toast.err('Cần ít nhất 1 ảnh tổng quan lớp.');
      return;
    }

    const fields = {
      schedule_id: scheduleId,
      present_count: String(nPresent),
      roster_size: String(nTotal),
      absent_names: absentNames.trim(),
      note: note.trim(),
      client_time: new Date().toISOString(),
    };
    const label = ['Điểm danh', schedule.class_name || schedule.class?.name || 'lớp', fmtDate(schedule.session_date || schedule.date)]
      .filter(Boolean).join(' ');

    // Mất mạng → lưu hàng đợi, đồng bộ tự động khi có sóng (giống chấm công CheckInOut).
    const queueIt = async () => {
      await enqueue({
        endpoint: '/api/attendance',
        fields,
        files: photos.map((p) => ({ field: 'photos', blob: p.blob, name: p.name })),
        label,
        kind: 'attendance',
      });
      toast.info('Chưa có mạng — đã lưu vào hàng đợi, sẽ tự gửi khi có sóng.');
      navigate('/diem-danh');
    };

    if (!isOnline()) {
      await queueIt();
      return;
    }

    setSending(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v !== '') fd.append(k, v);
      }
      photos.forEach((p) => fd.append('photos', p.blob, p.name || 'anh.jpg'));
      await api.upload('/api/attendance', fd);
      toast.ok('Đã điểm danh thành công.');
      navigate('/diem-danh');
    } catch (err) {
      if (err.status === 409) {
        toast.info('Buổi này đã được điểm danh trước đó.');
        setDone(true);
        fetchRecord(schedule);
      } else if (err.isOffline) {
        await queueIt();
      } else {
        toast.fromError(err);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader
        title={done ? 'Bản ghi điểm danh' : 'Điểm danh lớp'}
        sub={fmtDateLong(schedule.session_date || schedule.date)}
        actions={<Link to="/diem-danh" className="btn-line !py-1.5">‹ Quay lại</Link>}
      />

      {/* Thẻ thông tin buổi dạy — tự điền theo lịch phân công, không sửa được */}
      <div className="card p-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-lg truncate">{schedule.class_name || schedule.class?.name || 'Lớp học'}</div>
            <div className="text-sm text-ink-muted truncate">{schedule.school_name || schedule.school?.name}</div>
          </div>
          {done && <Badge tone="approved">Đã điểm danh</Badge>}
        </div>
        <div className="mt-3 grid gap-1.5">
          <InfoRow k="Thời gian" v={`${schedule.period ? `Tiết ${schedule.period} · ` : ''}${fmtDateLong(schedule.session_date || schedule.date)} · ${fmtRange(schedule.start_time, schedule.end_time)}`} />
          {(schedule.room_name || schedule.room?.name) && (
            <InfoRow k="Phòng" v={schedule.room_name || schedule.room?.name} />
          )}
          <InfoRow k="Người dạy" v={teacherNames || '—'} />
          {roster > 0 && <InfoRow k="Sĩ số gần nhất" v={`${roster} học sinh`} />}
        </div>
        <div className="text-xs text-ink-muted mt-2.5">
          ℹ️ Tự điền theo lịch phân công — không chỉnh sửa tại đây.
        </div>
      </div>

      {done ? (
        record ? (
          <RecordCard record={record} roster={roster} />
        ) : (
          <div className="card p-5 text-center">
            <div className="text-3xl mb-2">✅</div>
            <div className="font-semibold">Buổi này đã được điểm danh</div>
            <div className="text-sm text-ink-muted mt-1">
              Xem chi tiết trong tab Lịch sử của màn hình Điểm danh.
            </div>
            <Link to="/diem-danh" className="btn-primary mt-4">Về màn hình Điểm danh</Link>
          </div>
        )
      ) : !auth.can('attendance.submit') ? (
        <div className="card p-5 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <div className="font-semibold">Bạn không có quyền điểm danh buổi này</div>
          <Link to="/diem-danh" className="btn-line mt-4">Về màn hình Điểm danh</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="card p-4">
          <div className="label">Sĩ số thực tế buổi này</div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 mb-2">
            <CountInput label="Có mặt" value={present} onChange={setPresent} placeholder="?" />
            <span className="pb-2 text-2xl font-extrabold text-ink-muted">/</span>
            <CountInput label="Sĩ số" value={total ?? ''} onChange={setTotal} placeholder="?" tone="ink" />
          </div>
          <div className="text-xs text-ink-muted mb-3">
            Đếm thực tế tại lớp rồi điền: có mặt bao nhiêu / tổng sĩ số bao nhiêu.
            {roster > 0 && <> Sĩ số đang gợi ý theo lần điểm danh gần nhất ({roster}) — sửa lại nếu khác.</>}
          </div>

          <div className={`rounded-xl border px-3.5 py-2.5 mb-3.5 flex items-center justify-between
            ${over ? 'bg-rose-50 border-rose-200' : 'bg-brand-50 border-brand-100'}`}>
            <span className={`text-sm font-semibold ${over ? 'text-rose-700' : 'text-brand-900'}`}>
              {over ? 'Có mặt nhiều hơn sĩ số — kiểm tra lại'
                : missing > 0 ? `Vắng ${missing} học sinh`
                : nPresent !== null && nTotal !== null ? 'Đủ sĩ số' : 'Sĩ số buổi này'}
            </span>
            <span className="text-2xl font-extrabold text-brand-800" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {nPresent ?? '—'}
              <span className="text-lg text-ink-muted font-bold">/{nTotal ?? '—'}</span>
            </span>
          </div>

          <Field label="Học sinh vắng" hint="Mỗi em một dòng (hoặc cách nhau dấu phẩy) — hệ thống tự trừ vào sĩ số.">
            <textarea
              className="input"
              rows={3}
              value={absentNames}
              onChange={(e) => {
                const v = e.target.value;
                setAbsentNames(v);
                // Tự tính số có mặt = sĩ số − số em vắng đã liệt kê.
                if (nTotal) {
                  const n = v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).length;
                  if (n) setPresent(String(Math.max(0, nTotal - n)));
                }
              }}
              placeholder={'Ví dụ:\nNguyễn Văn A\nTrần Thị B'}
            />
          </Field>

          <PhotoInput
            label="Ảnh / video tổng quan lớp"
            required
            max={4}
            allowVideo
            value={photos}
            onChange={setPhotos}
            hint="Chụp bao quát cả lớp để đối chiếu sĩ số; có thể quay thêm video hoạt động của lớp."
          />

          <Field label="Ghi chú">
            <textarea
              className="input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tình hình lớp học, sự cố (nếu có)…"
            />
          </Field>

          {!online && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3.5 py-2.5 mb-3.5">
              ⚡ Đang offline — bản điểm danh sẽ được lưu và tự gửi khi có mạng.
            </div>
          )}

          <button type="submit" className="btn-primary w-full mt-1" disabled={sending}>
            {sending ? <Spinner className="border-white/40 border-t-white" /> : 'Gửi điểm danh'}
          </button>
        </form>
      )}
    </div>
  );
}
