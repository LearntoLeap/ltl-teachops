/**
 * CheckInOut.jsx — Chấm công ĐẦU BUỔI / CUỐI BUỔI tại một trường
 * (route /cham-cong/:schoolId?buoi=morning|afternoon).
 *
 * Chấm công KHÔNG gắn với tiết nào: giáo viên đến trường thì chấm công vào, ra
 * về thì chấm công ra, mỗi ca sáng/chiều một lần. Kiểm thiết bị đầu buổi và cuối
 * buổi nằm ở đây. Lịch dạy chỉ dùng để NHẮC mấy giờ phải có mặt.
 *
 * Luồng: GET /api/timesheets/my-shift?school_id=&date=&session=
 *   → chưa check-in: form CHECK-IN (GPS bắt buộc + ảnh + số thiết bị)
 *   → đã in, chưa out: form CHECK-OUT (GPS không bắt buộc + tình trạng thiết bị)
 *   → xong cả hai: màn tổng kết chỉ xem.
 *
 * Mất mạng: bản ghi được đưa vào hàng đợi offline (lib/offline.js) và tự gửi khi có mạng.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DeviceTally, { initialRows, tallyProblem, toPayload } from './DeviceTally.jsx';
import { api, fileUrl } from '../../lib/api.js';
import { LABEL, fmtDateLong, fmtDuration, fmtNumber, fmtRange, fmtTime } from '../../lib/format.js';
import { getPosition } from '../../lib/gps.js';
import { enqueue, isOnline } from '../../lib/offline.js';
import { Badge, ErrorBox, Field, PageHeader, PageLoading, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import PhotoInput from '../../components/PhotoInput.jsx';

/* ------------------------- Trích trường dữ liệu an toàn ------------------------- */
const clsName = (x) => x?.name || x?.school_name || 'Trường';

const SESSION_VN = { morning: 'buổi sáng', afternoon: 'buổi chiều' };

/** Đang là buổi sáng hay chiều theo giờ Việt Nam (mốc 12:00). */
const sessionNow = () => (new Date(Date.now() + 7 * 3600_000).getUTCHours() < 12 ? 'morning' : 'afternoon');

/** Hôm nay theo giờ Việt Nam — mốc nghiệp vụ của chấm công. */
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
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
function SessionCard({ shift }) {
  if (!shift) {
    return (
      <div className="card p-4 mb-4 text-sm text-ink-muted">
        Chưa tải được thông tin buổi (có thể do mất mạng).
      </div>
    );
  }
  return (
    <div className="card p-4 mb-4">
      <div className="text-sm text-ink-muted">{fmtDateLong(shift.date)}</div>
      <div className="text-lg font-extrabold text-brand-800">
        {SESSION_VN[shift.session] || 'buổi'}
      </div>
      <div className="font-semibold mt-1">{clsName(shift.school)}</div>
      <div className="text-sm text-ink-muted">
        {shift.planned?.start_time
          ? `${shift.planned.periods} tiết trong buổi — có mặt trước ${shift.planned.start_time}`
          : 'Buổi này không có tiết nào trong lịch dạy'}
      </div>
      {shift.planned?.items?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {shift.planned.items.map((p) => (
            <span key={p.id} className="rounded-md bg-brand-50 text-brand-900 px-2 py-1 text-xs font-semibold">
              {p.period ? `Tiết ${p.period}` : p.start_time} · {p.class_name}
              <span className="text-ink-muted font-medium"> {p.start_time}</span>
            </span>
          ))}
        </div>
      )}
      <div className="text-xs text-ink-muted mt-2">
        Tiết 1–5 là buổi sáng, tiết 6 trở đi là buổi chiều. Chấm công một lần vào, một lần ra cho cả buổi.
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
            <div className="text-sm font-semibold">✓ Đã lấy vị trí (±{pos.accuracy} m)</div>
            <div className="text-xs opacity-80">{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</div>
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
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
          <div className="font-semibold mb-1">⚠ {gpsErr.message}</div>
          {gpsErr.howTo && <div className="text-xs text-rose-600">{gpsErr.howTo}</div>}
          <button type="button" className="btn-line !py-1.5 mt-2" onClick={locate} disabled={busy}>
            Thử lại
          </button>
          {!required && (
            <div className="text-xs text-ink-muted mt-2">
              Check-out không bắt buộc vị trí — bạn vẫn có thể gửi mà không có GPS.
            </div>
          )}
        </div>
      )}

      {error && !gpsErr && <div className="text-xs text-rose-600 mt-1">{error}</div>}
    </div>
  );
}

/* --------------------------------- Form CHECK-IN -------------------------------- */
function CheckInForm({ shift, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const noteRef = useRef(null);

  const [pos, setPos] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selfies, setSelfies] = useState([]);        // ảnh chân dung xác minh có mặt
  // Thiết bị đầu buổi theo loại — dòng lấy sẵn từ danh mục thiết bị của trường.
  const [devRows, setDevRows] = useState(() => initialRows({ mode: 'in', catalog: shift?.devices?.catalog }));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    const errs = {};
    if (!pos) errs.pos = 'Vui lòng bấm "Lấy vị trí" trước khi chấm công.';
    if (!photos.length) errs.photos = 'Cần ít nhất 1 ảnh thiết bị đầu buổi.';
    if (!selfies.length) errs.selfie = 'Cần chụp 1 ảnh selfie tại trường để xác minh.';
    const devProblem = tallyProblem(devRows);
    if (devProblem) errs.device = devProblem;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const fields = {
      school_id: shift.school.id,
      date: shift.date,
      session: shift.session,
      // Chi tiết từng loại (JSON) + tổng để máy chủ cũ vẫn hiểu.
      devices: JSON.stringify(toPayload(devRows)),
      device_count: devRows.reduce((n, r) => n + (Number(r.qty) || 0), 0),
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
        label: `Chấm công vào ${SESSION_VN[shift.session]} — ${clsName(shift.school)}`,
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
      <SessionCard shift={shift} />

      <div className="card p-4">
        <GpsBlock pos={pos} setPos={(p) => { setPos(p); if (p) setErrors((x) => ({ ...x, pos: '' })); }}
          required error={errors.pos} />

        <PhotoInput
          value={selfies}
          onChange={(v) => { setSelfies(v); if (v.length) setErrors((x) => ({ ...x, selfie: '' })); }}
          max={1}
          required
          capture="user"
          label="Ảnh selfie tại trường"
          hint="Chụp bằng camera trước, thấy rõ mặt bạn và khung cảnh trường." />
        {errors.selfie && <div className="text-xs text-rose-600 -mt-2 mb-3">{errors.selfie}</div>}

        <PhotoInput
          value={photos}
          onChange={(v) => { setPhotos(v); if (v.length) setErrors((x) => ({ ...x, photos: '' })); }}
          max={3}
          required
          label="Ảnh thiết bị đầu buổi"
          hint="Chụp rõ khu vực thiết bị. Ảnh đầu tiên sẽ được dùng làm minh chứng." />
        {errors.photos && <div className="text-xs text-rose-600 -mt-2 mb-3">{errors.photos}</div>}

        <DeviceTally
          mode="in"
          rows={devRows}
          suggestions={shift?.devices?.suggestions}
          error={errors.device}
          onChange={(v) => { setDevRows(v); if (errors.device) setErrors((x) => ({ ...x, device: '' })); }} />

        <Field label="Ghi chú" hint="Bắt buộc nếu bạn đứng ngoài khuôn viên trường." error={errors.note}>
          <textarea
            ref={noteRef}
            className="input min-h-[84px]"
            placeholder="Ví dụ: cổng trường đóng, chấm công từ bãi giữ xe…"
            value={note}
            onChange={(e) => { setNote(e.target.value); if (errors.note) setErrors((x) => ({ ...x, note: '' })); }} />
        </Field>

        <button
          className="btn-primary w-full !py-4 text-lg font-extrabold tracking-wide"
          disabled={sending}
          onClick={submit}>
          {sending ? <Spinner className="border-white/40 border-t-white" /> : '📍 CHẤM CÔNG VÀO'}
        </button>
      </div>
    </>
  );
}

/* -------------------------------- Form CHECK-OUT -------------------------------- */
function CheckOutForm({ shift, ts, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();

  const [pos, setPos] = useState(null);
  // Đếm lại cuối buổi theo đúng các loại đã đếm đầu buổi.
  const [devRows, setDevRows] = useState(() => initialRows({
    mode: 'out', catalog: shift?.devices?.catalog, checkIn: ts?.check_in_devices,
    suggestions: shift?.devices?.suggestions,
  }));
  // Chỉ đối chiếu khi đầu buổi đã đếm theo loại (bản ghi cũ chỉ có con số tổng).
  const hasDetail = !!ts?.check_in_devices?.length;
  const shortRows = devRows.filter((r) => r.ref != null && r.qty !== '' && Number(r.qty) < r.ref);
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
    if (hasDetail) {
      const devProblem = tallyProblem(devRows);
      if (devProblem) errs.device = devProblem;
    }
    if (!deviceOk) {
      if (!damageNote.trim()) errs.damage = 'Vui lòng mô tả thiết bị hỏng.';
      if (!damagePhotos.length) errs.damagePhotos = 'Cần ít nhất 1 ảnh thiết bị hỏng.';
    }
    // Thiếu so với đầu buổi ⇒ bắt buộc ghi lý do (ảnh không bắt buộc).
    if (shortRows.length && !damageNote.trim()) {
      errs.damage = `Thiếu ${shortRows.map((r) => `${r.name} ${r.ref - Number(r.qty)}`).join(', ')} so với đầu buổi — vui lòng ghi rõ lý do.`;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const fields = {
      school_id: shift.school.id,
      date: shift.date,
      session: shift.session,
      device_ok: deviceOk,
      note: note.trim(),
      client_time: new Date().toISOString(),
    };
    if (pos) {
      fields.lat = pos.lat;
      fields.lng = pos.lng;
      fields.accuracy = pos.accuracy;
    }
    if (!deviceOk || shortRows.length) fields.damage_note = damageNote.trim();
    if (hasDetail) fields.devices = JSON.stringify(toPayload(devRows));

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
        label: `Chấm công ra ${SESSION_VN[shift.session]} — ${clsName(shift.school)}`,
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
      if (e?.status === 422 && (!deviceOk || shortRows.length)) {
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
      <SessionCard shift={shift} />

      {ts?.check_in_at && (
        <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800 mb-4">
          ✓ Đã check-in lúc <b>{fmtTime(ts.check_in_at)}</b>
          {Number(ts.late_minutes) > 0 && <> · trễ {fmtNumber(ts.late_minutes)} phút</>}
        </div>
      )}

      <div className="card p-4">
        <GpsBlock pos={pos} setPos={setPos} required={false} />

        {hasDetail && (
          <DeviceTally
            mode="out"
            rows={devRows}
            suggestions={shift?.devices?.suggestions}
            error={errors.device}
            onChange={(v) => { setDevRows(v); if (errors.device) setErrors((x) => ({ ...x, device: '' })); }} />
        )}

        {shortRows.length > 0 && deviceOk && (
          <Field label="Lý do thiếu thiết bị" required error={errors.damage}
            hint="Hệ thống sẽ tự mở phiếu báo cho Phòng chuyên môn.">
            <textarea className="input" rows={2} value={damageNote}
              onChange={(e) => { setDamageNote(e.target.value); if (errors.damage) setErrors((x) => ({ ...x, damage: '' })); }}
              placeholder="VD: 2 laptop giáo viên chủ nhiệm mượn, sẽ trả sáng mai." />
          </Field>
        )}

        <div className="mb-3.5">
          <div className="label">Tình trạng thiết bị <span className="text-rose-500">*</span></div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tình trạng thiết bị">
            <button
              type="button" role="radio" aria-checked={deviceOk}
              onClick={() => { setDeviceOk(true); setErrors({}); }}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold transition
                ${deviceOk ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-line text-ink-muted hover:border-emerald-200'}`}>
              ✅ Thiết bị nguyên vẹn
            </button>
            <button
              type="button" role="radio" aria-checked={!deviceOk}
              onClick={() => setDeviceOk(false)}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold transition
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
            {errors.damagePhotos && <div className="text-xs text-rose-600 -mt-2 mb-3">{errors.damagePhotos}</div>}
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
          className="btn-primary w-full !py-4 text-lg font-extrabold tracking-wide"
          disabled={sending}
          onClick={submit}>
          {sending ? <Spinner className="border-white/40 border-t-white" /> : '🏁 CHẤM CÔNG RA'}
        </button>
      </div>
    </>
  );
}

/* -------------------------------- Màn tổng kết ---------------------------------- */
/** Bảng đối chiếu thiết bị từng loại: đầu buổi ↔ cuối buổi. */
function DeviceSummary({ ts }) {
  const inList = ts?.check_in_devices || [];
  const outList = ts?.check_out_devices || [];
  if (!inList.length && !outList.length) {
    if (ts?.check_in_device_count == null) return null;
    return (
      <div className="text-sm text-ink-soft mb-3">
        Thiết bị đầu buổi: <b>{fmtNumber(ts.check_in_device_count)}</b>
      </div>
    );
  }
  const key = (n) => String(n || '').trim().toLowerCase();
  const outBy = new Map(outList.map((d) => [key(d.name), d]));
  const names = [...inList.map((d) => d.name), ...outList.filter((d) => !inList.some((x) => key(x.name) === key(d.name))).map((d) => d.name)];
  const inBy = new Map(inList.map((d) => [key(d.name), d]));
  return (
    <div className="mb-3">
      <div className="label">Thiết bị theo loại</div>
      <div className="rounded-lg border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-ink-muted text-xs">
            <tr>
              <th className="text-left font-semibold px-3 py-1.5">Loại</th>
              <th className="text-right font-semibold px-2 py-1.5">Đầu buổi</th>
              <th className="text-right font-semibold px-3 py-1.5">Cuối buổi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {names.map((n) => {
              const a = inBy.get(key(n));
              const b = outBy.get(key(n));
              const short = a && b && b.qty < a.qty;
              return (
                <tr key={n} className={short ? 'bg-rose-50/70' : ''}>
                  <td className="px-3 py-1.5 font-medium text-ink">{n}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a ? a.qty : '—'}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${short ? 'text-rose-700 font-semibold' : ''}`}>
                    {b ? b.qty : '—'}{short && <span className="text-xs"> (thiếu {a.qty - b.qty})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DoneView({ shift, ts }) {
  const navigate = useNavigate();
  const mins = workedMinutes(ts);
  const photos = tsPhotos(ts);
  const deviceBroken = ts?.device_ok === false || ts?.device_ok === 'false';

  return (
    <>
      <SessionCard shift={shift} />

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <AttendBadge label={ts?.label} />
          {Number(ts?.late_minutes) > 0 && (
            <span className="text-sm text-amber-700 font-semibold">Trễ {fmtNumber(ts.late_minutes)} phút</span>
          )}
          {ts?.approval_status && (
            <Badge tone={ts.approval_status}>{LABEL.approval[ts.approval_status] || ts.approval_status}</Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-xs text-ink-muted">Check-in</div>
            <div className="font-extrabold text-brand-800">{fmtTime(ts?.check_in_at) || '—'}</div>
          </div>
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-xs text-ink-muted">Check-out</div>
            <div className="font-extrabold text-brand-800">{fmtTime(ts?.check_out_at) || '—'}</div>
          </div>
          <div className="rounded-xl bg-brand-50 py-2.5">
            <div className="text-xs text-ink-muted">Thời lượng</div>
            <div className="font-extrabold text-brand-800">{fmtDuration(mins)}</div>
          </div>
        </div>

        {ts?.approval_status === 'pending' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3.5 py-2.5 mb-3">
            ⏳ Bản chấm công đang chờ Phòng chuyên môn duyệt.
          </div>
        )}
        {ts?.approval_status === 'rejected' && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3.5 py-2.5 mb-3">
            Bản chấm công bị từ chối{ts?.approval_reason ? ` — lý do: ${ts.approval_reason}` : '.'}
          </div>
        )}

        <DeviceSummary ts={ts} />

        {(deviceBroken || ts?.device_shortage) && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3.5 py-2.5 mb-3">
            ⚠️ {ts?.device_shortage ? 'Thiếu thiết bị cuối buổi' + (deviceBroken ? ', có thiết bị hỏng' : '') : 'Có thiết bị hỏng'}
            {ts?.damage_note ? `: ${ts.damage_note}` : ' (đã báo Phòng chuyên môn).'}
          </div>
        )}

        {ts?.note && (
          <div className="rounded-xl bg-canvas px-3.5 py-2.5 text-sm text-ink-soft mb-3">
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
                  <div className="text-xs text-ink-muted mt-0.5">{p.label}</div>
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
  const { schoolId } = useParams();
  const [params] = useSearchParams();
  const session = params.get('buoi') === 'afternoon' || params.get('buoi') === 'morning'
    ? params.get('buoi') : sessionNow();
  const date = params.get('ngay') || vnToday();
  const [shift, setShift] = useState(null);
  const [ts, setTs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [forcedStep, setForcedStep] = useState(null); // 'in' | 'out' — khi mất mạng không tải được trạng thái

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const mine = await api.get('/api/timesheets/my-shift', { school_id: schoolId, date, session });
      setShift({
        school: mine.school, date: mine.date, session: mine.session, planned: mine.planned,
        devices: mine.devices,   // danh mục thiết bị của trường + loại dùng chung
      });
      setTs(mine.item || null);
      setForcedStep(null);
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  }, [schoolId, date, session]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading label="Đang tải thông tin buổi làm việc…" />;

  if (loadErr && !forcedStep) {
    return (
      <>
        <PageHeader title="Chấm công" />
        <ErrorBox error={loadErr} onRetry={load} />
        {loadErr.isOffline && (
          <div className="card p-4 mt-4">
            <div className="text-sm text-ink-soft mb-3">
              Bạn đang offline nên chưa tải được trạng thái buổi làm việc. Vẫn có thể chấm công —
              dữ liệu sẽ lưu trên máy và tự gửi khi có mạng.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary" onClick={() => setForcedStep('in')}>📍 Chấm công vào</button>
              <button className="btn-line" onClick={() => setForcedStep('out')}>🏁 Chấm công ra</button>
            </div>
          </div>
        )}
      </>
    );
  }

  const step = forcedStep
    || (ts?.check_in_at && ts?.check_out_at ? 'done' : ts?.check_in_at ? 'out' : 'in');

  const title = step === 'in' ? `Chấm công vào ${SESSION_VN[session]}`
    : step === 'out' ? `Chấm công ra ${SESSION_VN[session]}`
    : 'Chi tiết chấm công';

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader
        title={title}
        sub={step === 'in' ? 'Đến trường: lấy vị trí, chụp ảnh thiết bị đầu buổi rồi chấm công vào.'
          : step === 'out' ? 'Ra về: kiểm thiết bị cuối buổi rồi chấm công ra.'
          : 'Buổi này đã chấm công đủ vào và ra.'} />

      {step === 'in' && (
        <CheckInForm shift={shift} onDone={load} />
      )}
      {step === 'out' && (
        <CheckOutForm shift={shift} ts={ts} onDone={load} />
      )}
      {step === 'done' && (
        <DoneView shift={shift} ts={ts} />
      )}
    </div>
  );
}
