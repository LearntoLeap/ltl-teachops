/**
 * CheckInOut.jsx — Check-in / Check-out một buổi dạy (route /cham-cong/:scheduleId).
 *
 * Luồng: GET /api/schedules/:id + GET /api/timesheets/my/:scheduleId
 *   → chưa check-in: form CHECK-IN (GPS bắt buộc + ảnh + số thiết bị)
 *   → đã in, chưa out: form CHECK-OUT (GPS không bắt buộc + tình trạng thiết bị)
 *   → xong cả hai: màn tổng kết chỉ xem.
 *
 * Mất mạng: bản ghi được đưa vào hàng đợi offline (lib/offline.js) và tự gửi khi có mạng.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { LABEL, fmtDateLong, fmtDuration, fmtNumber, fmtRange, fmtTime } from '../../lib/format.js';
import { getPosition } from '../../lib/gps.js';
import { enqueue, isOnline } from '../../lib/offline.js';
import { Badge, ErrorBox, Field, PageHeader, PageLoading, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';

/* ------------------------- Trích trường dữ liệu an toàn ------------------------- */
const clsName = (x) => x?.class_name || x?.class?.name || 'Lớp';
const schName = (x) => x?.school_name || x?.school?.name || '';
const roomName = (x) => x?.room_name || x?.room?.name || '';

function workedMinutes(ts) {
  const direct = Number(ts?.work_minutes ?? ts?.worked_minutes ?? ts?.duration_minutes);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const a = new Date(ts?.check_in_at);
  const b = new Date(ts?.check_out_at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function tsPhotos(ts) {
  return [
    { id: ts?.check_in_photo_id || ts?.checkin_photo_id, label: 'Ảnh đầu buổi' },
    { id: ts?.check_out_photo_id || ts?.checkout_photo_id, label: 'Ảnh cuối buổi' },
    { id: ts?.check_in_selfie_id, label: 'Ảnh selfie đầu buổi' },
    { id: ts?.damage_photo_id, label: 'Ảnh thiết bị hỏng' },
  ].filter((p) => p.id);
}

function AttendBadge({ label }) {
  if (!label) return null;
  return <Badge tone={label}>{LABEL.attend[label] || label}</Badge>;
}

/* ------------------------------- Thẻ thông tin buổi ------------------------------ */
function SessionCard({ schedule, scheduleId }) {
  if (!schedule) {
    return (
      <div className="card p-4 mb-4 text-[13.5px] text-ink-muted">
        Buổi dạy #{scheduleId} — chưa tải được chi tiết (có thể do mất mạng).
      </div>
    );
  }
  return (
    <div className="card p-4 mb-4">
      <div className="text-[12.5px] text-ink-muted">{fmtDateLong(schedule.session_date || schedule.date)}</div>
      <div className="text-lg font-extrabold text-brand-800">
        {fmtRange(schedule.start_time, schedule.end_time)}
      </div>
      <div className="font-semibold mt-1">{clsName(schedule)}</div>
      <div className="text-[13px] text-ink-muted">
        {schName(schedule)}{roomName(schedule) ? ` · ${roomName(schedule)}` : ''}
      </div>
    </div>
  );
}

/* --------------------------------- Khối lấy GPS --------------------------------- */
function GpsBlock({ pos, setPos, required, error }) {
  const [busy, setBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState(null);

  const locate = async () => {
    if (busy) return;
    setBusy(true);
    setGpsErr(null);
    try {
      setPos(await getPosition());
    } catch (e) {
      setPos(null);
      setGpsErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3.5">
      <div className="label">
        Vị trí hiện tại {required && <span className="text-rose-500">*</span>}
      </div>

      {pos ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 flex items-center justify-between gap-2">
          <div className="text-emerald-800">
            <div className="text-[13.5px] font-semibold">✓ Đã lấy vị trí (±{pos.accuracy} m)</div>
            <div className="text-[12px] opacity-80">{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</div>
          </div>
          <button type="button" className="btn-line !py-1.5 !px-3 shrink-0" onClick={locate} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Lấy lại'}
          </button>
        </div>
      ) : (
        <button type="button" onClick={locate} disabled={busy} className="btn-line w-full !py-3">
          {busy ? <><Spinner /> Đang định vị…</> : '📡 Lấy vị trí'}
        </button>
      )}

      {gpsErr && (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-700">
          <div className="font-semibold mb-1">⚠ {gpsErr.message}</div>
          {gpsErr.howTo && <div className="text-[12px] text-rose-600">{gpsErr.howTo}</div>}
          <button type="button" className="btn-line !py-1.5 mt-2" onClick={locate} disabled={busy}>
            Thử lại
          </button>
          {!required && (
            <div className="text-[12px] text-ink-muted mt-2">
              Check-out không bắt buộc vị trí — bạn vẫn có thể gửi mà không có GPS.
            </div>
          )}
        </div>
      )}

      {error && !gpsErr && <div className="text-[12px] text-rose-600 mt-1">{error}</div>}
    </div>
  );
}

/* --------------------------------- Form CHECK-IN -------------------------------- */
function CheckInForm({ scheduleId, schedule, linked = false, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const noteRef = useRef(null);

  const [pos, setPos] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selfies, setSelfies] = useState([]);        // ảnh chân dung xác minh có mặt
  const [deviceCount, setDeviceCount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    const errs = {};
    if (!linked && !pos) errs.pos = 'Vui lòng bấm "Lấy vị trí" trước khi check-in.';
    if (!linked && !photos.length) errs.photos = 'Cần ít nhất 1 ảnh thiết bị đầu buổi.';
    if (!linked && !selfies.length) errs.selfie = 'Cần chụp 1 ảnh selfie tại lớp để xác minh.';
    if (deviceCount === '' || Number(deviceCount) < 0 || !Number.isFinite(Number(deviceCount))) {
      errs.device = 'Vui lòng nhập số thiết bị đếm được.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const fields = {
      schedule_id: scheduleId,
      device_count: Number(deviceCount),
      note: note.trim(),
      client_time: new Date().toISOString(),
    };
    if (pos) { fields.lat = pos.lat; fields.lng = pos.lng; fields.accuracy = pos.accuracy; }
    const photo = photos[0] || null;
    const selfie = selfies[0] || null;

    const saveOffline = async () => {
      await enqueue({
        endpoint: '/api/timesheets/check-in',
        fields,
        files: [
          ...(photo ? [{ field: 'photo', blob: photo.blob, name: photo.name }] : []),
          ...(selfie ? [{ field: 'selfie', blob: selfie.blob, name: selfie.name }] : []),
        ],
        label: `Check-in ${schedule ? clsName(schedule) : 'buổi dạy'} ${schedule ? fmtTime(schedule.start_time) : ''}`.trim(),
        kind: 'checkin',
      });
      toast.info('Đã lưu offline — sẽ tự gửi khi có mạng');
      navigate('/cham-cong');
    };

    if (!isOnline()) { await saveOffline(); return; }

    setSending(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null || v === '') continue;
        fd.append(k, String(v));
      }
      // API nhận đúng 1 ảnh ở field 'photo' — chỉ gửi ảnh đầu tiên (tiết nối tiếp có thể bỏ trống).
      if (photo) fd.append('photo', photo.blob, photo.name || 'anh-dau-buoi.jpg');
      if (selfie) fd.append('selfie', selfie.blob, selfie.name || 'selfie.jpg');

      const res = await api.upload('/api/timesheets/check-in', fd);

      const lateMin = Number(res?.late_minutes) || 0;
      if (res?.label === 'late') {
        toast.info(lateMin ? `Check-in trễ ${lateMin} phút — đã ghi nhận` : 'Check-in trễ — đã ghi nhận');
      } else {
        toast.ok('Check-in đúng giờ');
      }
      if (res?.gps_flagged) toast.info('Vị trí lệch — chờ Phòng chuyên môn duyệt');
      onDone();
    } catch (e) {
      if (e?.isOffline) { await saveOffline(); return; }
      if (e?.status === 422) {
        // Ngoài bán kính mà thiếu ghi chú — hiện lý do và đưa con trỏ vào ô ghi chú.
        setErrors((x) => ({ ...x, note: e.message }));
        noteRef.current?.focus();
        return;
      }
      if (e?.status === 409) {
        toast.info('Bạn đã check-in buổi này rồi.');
        onDone();
        return;
      }
      toast.fromError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SessionCard schedule={schedule} scheduleId={scheduleId} />

      <div className="card p-4">
        {linked && (
          <div className="rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-[13px] px-3.5 py-2.5 mb-3.5">
            🔁 <b>Tiết nối tiếp trong buổi</b> — vị trí đã xác minh ở tiết đầu.
            Chỉ cần cập nhật số thiết bị; GPS và ảnh không bắt buộc.
          </div>
        )}
        {!linked && (
          <GpsBlock pos={pos} setPos={(p) => { setPos(p); if (p) setErrors((x) => ({ ...x, pos: '' })); }}
            required error={errors.pos} />
        )}

        <PhotoInput
          value={selfies}
          onChange={(v) => { setSelfies(v); if (v.length) setErrors((x) => ({ ...x, selfie: '' })); }}
          max={1}
          required={!linked}
          capture="user"
          label="Ảnh selfie tại lớp"
          hint="Chụp bằng camera trước, thấy rõ mặt bạn và khung cảnh lớp học." />
        {errors.selfie && <div className="text-[12px] text-rose-600 -mt-2 mb-3">{errors.selfie}</div>}

        <PhotoInput
          value={photos}
          onChange={(v) => { setPhotos(v); if (v.length) setErrors((x) => ({ ...x, photos: '' })); }}
          max={3}
          required={!linked}
          label="Ảnh thiết bị đầu buổi"
          hint="Chụp rõ khu vực thiết bị. Ảnh đầu tiên sẽ được dùng làm minh chứng." />
        {errors.photos && <div className="text-[12px] text-rose-600 -mt-2 mb-3">{errors.photos}</div>}

        <Field label="Số thiết bị đếm được" required error={errors.device}>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="Ví dụ: 12"
            value={deviceCount}
            onChange={(e) => { setDeviceCount(e.target.value); if (errors.device) setErrors((x) => ({ ...x, device: '' })); }} />
        </Field>

        <Field label="Ghi chú" hint="Bắt buộc nếu bạn đứng ngoài khuôn viên trường." error={errors.note}>
          <textarea
            ref={noteRef}
            className="input min-h-[84px]"
            placeholder="Ví dụ: cổng trường đóng, chấm công từ bãi giữ xe…"
            value={note}
            onChange={(e) => { setNote(e.target.value); if (errors.note) setErrors((x) => ({ ...x, note: '' })); }} />
        </Field>

        <button
          className="btn-primary w-full !py-4 text-[16px] font-extrabold tracking-wide"
          disabled={sending}
          onClick={submit}>
          {sending ? <Spinner className="border-white/40 border-t-white" /> : '📍 CHECK-IN'}
        </button>
      </div>
    </>
  );
}

/* -------------------------------- Form CHECK-OUT -------------------------------- */
function CheckOutForm({ scheduleId, schedule, ts, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();

  const [pos, setPos] = useState(null);
  const [deviceOk, setDeviceOk] = useState(true);
  const [damageNote, setDamageNote] = useState('');
  const [damagePhotos, setDamagePhotos] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    const errs = {};
    if (!deviceOk) {
      if (!damageNote.trim()) errs.damage = 'Vui lòng mô tả thiết bị hỏng.';
      if (!damagePhotos.length) errs.damagePhotos = 'Cần ít nhất 1 ảnh thiết bị hỏng.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const fields = {
      schedule_id: scheduleId,
      device_ok: deviceOk,
      note: note.trim(),
      client_time: new Date().toISOString(),
    };
    if (pos) {
      fields.lat = pos.lat;
      fields.lng = pos.lng;
      fields.accuracy = pos.accuracy;
    }
    if (!deviceOk) fields.damage_note = damageNote.trim();

    const files = [];
    if (photos[0]) files.push({ field: 'photo', blob: photos[0].blob, name: photos[0].name });
    if (!deviceOk && damagePhotos[0]) {
      files.push({ field: 'damage_photo', blob: damagePhotos[0].blob, name: damagePhotos[0].name });
    }

    const saveOffline = async () => {
      await enqueue({
        endpoint: '/api/timesheets/check-out',
        fields,
        files,
        label: `Check-out ${schedule ? clsName(schedule) : 'buổi dạy'} ${schedule ? fmtTime(schedule.end_time) : ''}`.trim(),
        kind: 'checkout',
      });
      toast.info('Đã lưu offline — sẽ tự gửi khi có mạng');
      navigate('/cham-cong');
    };

    if (!isOnline()) { await saveOffline(); return; }

    setSending(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null || v === '') continue;
        fd.append(k, String(v));
      }
      for (const f of files) fd.append(f.field, f.blob, f.name || 'anh.jpg');

      await api.upload('/api/timesheets/check-out', fd);
      toast.ok('Đã check-out — hoàn tất buổi dạy');
      onDone();
    } catch (e) {
      if (e?.isOffline) { await saveOffline(); return; }
      if (e?.status === 422 && !deviceOk) {
        setErrors((x) => ({ ...x, damage: e.message }));
        return;
      }
      if (e?.status === 409) {
        toast.info('Buổi này đã được check-out trước đó.');
        onDone();
        return;
      }
      toast.fromError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SessionCard schedule={schedule} scheduleId={scheduleId} />

      {ts?.check_in_at && (
        <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800 mb-4">
          ✓ Đã check-in lúc <b>{fmtTime(ts.check_in_at)}</b>
          {Number(ts.late_minutes) > 0 && <> · trễ {fmtNumber(ts.late_minutes)} phút</>}
        </div>
      )}

      <div className="card p-4">
        <GpsBlock pos={pos} setPos={setPos} required={false} />

        <div className="mb-3.5">
          <div className="label">Tình trạng thiết bị <span className="text-rose-500">*</span></div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tình trạng thiết bị">
            <button
              type="button" role="radio" aria-checked={deviceOk}
              onClick={() => { setDeviceOk(true); setErrors({}); }}
              className={`rounded-xl border-2 px-3 py-3 text-[13.5px] font-semibold transition
                ${deviceOk ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-line text-ink-muted hover:border-emerald-200'}`}>
              ✅ Thiết bị nguyên vẹn
            </button>
            <button
              type="button" role="radio" aria-checked={!deviceOk}
              onClick={() => setDeviceOk(false)}
              className={`rounded-xl border-2 px-3 py-3 text-[13.5px] font-semibold transition
                ${!deviceOk ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-line text-ink-muted hover:border-rose-200'}`}>
              ⚠️ Có thiết bị hỏng
            </button>
          </div>
        </div>

        {!deviceOk && (
          <>
            <Field label="Mô tả thiết bị hỏng" required error={errors.damage}>
              <textarea
                className="input min-h-[72px]"
                placeholder="Thiết bị nào hỏng, hỏng ra sao, do đâu…"
                value={damageNote}
                onChange={(e) => { setDamageNote(e.target.value); if (errors.damage) setErrors((x) => ({ ...x, damage: '' })); }} />
            </Field>
            <PhotoInput
              value={damagePhotos}
              onChange={(v) => { setDamagePhotos(v); if (v.length) setErrors((x) => ({ ...x, damagePhotos: '' })); }}
              max={3}
              required
              label="Ảnh thiết bị hỏng"
              hint="Phòng chuyên môn sẽ nhận được thông báo kèm ảnh này." />
            {errors.damagePhotos && <div className="text-[12px] text-rose-600 -mt-2 mb-3">{errors.damagePhotos}</div>}
          </>
        )}

        <PhotoInput
          value={photos}
          onChange={setPhotos}
          max={3}
          label="Ảnh cuối buổi (tuỳ chọn)"
          hint="Ảnh đầu tiên sẽ được dùng làm minh chứng." />

        <Field label="Ghi chú (tuỳ chọn)">
          <textarea
            className="input min-h-[64px]"
            placeholder="Ghi chú thêm về buổi dạy…"
            value={note}
            onChange={(e) => setNote(e.target.value)} />
        </Field>

        <button
          className="btn-primary w-full !py-4 text-[16px] font-extrabold tracking-wide"
          disabled={sending}
          onClick={submit}>
          {sending ? <Spinner className="border-white/40 border-t-white" /> : '🏁 CHECK-OUT'}
        </button>
      </div>
    </>
  );
}

/* -------------------------------- Màn tổng kết ---------------------------------- */
function DoneView({ scheduleId, schedule, ts }) {
  const navigate = useNavigate();
  const mins = workedMinutes(ts);
  const photos = tsPhotos(ts);
  const deviceBroken = ts?.device_ok === false || ts?.device_ok === 'false';

  return (
    <>
      <SessionCard schedule={schedule} scheduleId={scheduleId} />

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <AttendBadge label={ts?.label} />
          {Number(ts?.late_minutes) > 0 && (
            <span className="text-[13px] text-amber-700 font-semibold">Trễ {fmtNumber(ts.late_minutes)} phút</span>
          )}
          {ts?.approval_status && (
            <Badge tone={ts.approval_status}>{LABEL.approval[ts.approval_status] || ts.approval_status}</Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-[11.5px] text-ink-muted">Check-in</div>
            <div className="font-extrabold text-brand-800">{fmtTime(ts?.check_in_at) || '—'}</div>
          </div>
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-[11.5px] text-ink-muted">Check-out</div>
            <div className="font-extrabold text-brand-800">{fmtTime(ts?.check_out_at) || '—'}</div>
          </div>
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-[11.5px] text-ink-muted">Thời lượng</div>
            <div className="font-extrabold text-brand-800">{fmtDuration(mins)}</div>
          </div>
        </div>

        {ts?.approval_status === 'pending' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3.5 py-2.5 mb-3">
            ⏳ Bản chấm công đang chờ Phòng chuyên môn duyệt.
          </div>
        )}
        {ts?.approval_status === 'rejected' && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3.5 py-2.5 mb-3">
            Bản chấm công bị từ chối{ts?.approval_reason ? ` — lý do: ${ts.approval_reason}` : '.'}
          </div>
        )}

        {deviceBroken && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3.5 py-2.5 mb-3">
            ⚠️ Có thiết bị hỏng{ts?.damage_note ? `: ${ts.damage_note}` : ' (đã báo Phòng chuyên môn).'}
          </div>
        )}

        {ts?.note && (
          <div className="rounded-xl bg-canvas px-3.5 py-2.5 text-[13px] text-ink-soft mb-3">
            📝 {ts.note}
          </div>
        )}

        {photos.length > 0 && (
          <div>
            <div className="label">Ảnh đã chụp</div>
            <div className="flex flex-wrap gap-2.5">
              {photos.map((p) => (
                <a key={p.id} href={fileUrl(p.id)} target="_blank" rel="noreferrer"
                  className="block text-center" title="Mở ảnh đầy đủ">
                  <img
                    src={fileUrl(p.id, { thumb: true })}
                    alt={p.label}
                    className="h-20 w-20 rounded-xl object-cover border border-line" />
                  <div className="text-[10.5px] text-ink-muted mt-0.5">{p.label}</div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <button className="btn-line w-full mt-4" onClick={() => navigate('/cham-cong')}>
        ← Về trang Chấm công
      </button>
    </>
  );
}

/* ================================ Màn hình chính ================================ */

export default function CheckInOut() {
  const { scheduleId } = useParams();
  const [schedule, setSchedule] = useState(null);
  const [ts, setTs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [forcedStep, setForcedStep] = useState(null); // 'in' | 'out' — khi mất mạng không tải được trạng thái
  const [blockDone, setBlockDone] = useState(false);   // đã check-in tiết khác cùng buổi (sáng/chiều)

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [sch, mine] = await Promise.all([
        api.get(`/api/schedules/${scheduleId}`),
        api.get(`/api/timesheets/my/${scheduleId}`).catch((e) => {
          if (e?.status === 404 || e?.status === 403) return null; // chưa có bản ghi chấm công
          throw e;
        }),
      ]);
      setSchedule(sch);
      // Server trả {item: bản ghi | null} — bóc lớp bọc (giữ tương thích nếu trả thẳng).
      setTs(mine && 'item' in mine ? mine.item : (mine || null));
      setBlockDone(!!mine?.block_checked_in);
      setForcedStep(null);
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading label="Đang tải thông tin buổi dạy…" />;

  if (loadErr && !forcedStep) {
    return (
      <>
        <PageHeader title="Chấm công buổi dạy" />
        <ErrorBox error={loadErr} onRetry={load} />
        {loadErr.isOffline && (
          <div className="card p-4 mt-4">
            <div className="text-[13.5px] text-ink-soft mb-3">
              Bạn đang offline nên chưa tải được trạng thái buổi dạy. Vẫn có thể chấm công —
              dữ liệu sẽ lưu trên máy và tự gửi khi có mạng.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary" onClick={() => setForcedStep('in')}>📍 Check-in</button>
              <button className="btn-line" onClick={() => setForcedStep('out')}>🏁 Check-out</button>
            </div>
          </div>
        )}
      </>
    );
  }

  const step = forcedStep
    || (ts?.check_in_at && ts?.check_out_at ? 'done' : ts?.check_in_at ? 'out' : 'in');

  const title = step === 'in' ? 'Check-in buổi dạy'
    : step === 'out' ? 'Check-out buổi dạy'
    : 'Chi tiết chấm công';

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader
        title={title}
        sub={step === 'in' ? 'Lấy vị trí, chụp ảnh thiết bị rồi bấm CHECK-IN.'
          : step === 'out' ? 'Xác nhận tình trạng thiết bị rồi bấm CHECK-OUT.'
          : 'Buổi dạy đã hoàn tất chấm công.'} />

      {step === 'in' && (
        <CheckInForm scheduleId={scheduleId} schedule={schedule} linked={blockDone} onDone={load} />
      )}
      {step === 'out' && (
        <CheckOutForm scheduleId={scheduleId} schedule={schedule} ts={ts} onDone={load} />
      )}
      {step === 'done' && (
        <DoneView scheduleId={scheduleId} schedule={schedule} ts={ts} />
      )}
    </div>
  );
}
