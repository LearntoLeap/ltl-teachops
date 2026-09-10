/**
 * SchoolDetail.jsx — Chi tiết một trường (route /to-chuc/:schoolId, quyền org.manage).
 *
 * 3 tab: Thông tin (sửa cấu hình + vô hiệu hoá — admin), Lớp (bảng lớp + phân công GV/TG),
 * Phòng STEM (thêm/sửa/xoá phòng).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtNumber } from '../../lib/format.js';
import { getPosition } from '../../lib/gps.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, PageLoading, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';

const SLOT_KEYS = Object.keys(LABEL.slot);

/** '' → null; số hợp lệ → Number; sai định dạng → NaN (để báo lỗi). */
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* ============================== TAB: THÔNG TIN ============================= */

function fromSchool(s) {
  return {
    code: s.code || '',
    name: s.name || '',
    address: s.address || '',
    province: s.province || '',
    lat: s.lat != null ? String(s.lat) : '',
    lng: s.lng != null ? String(s.lng) : '',
    gps_radius_m: s.gps_radius_m != null ? String(s.gps_radius_m) : '1000',
    grace_minutes: s.grace_minutes != null ? String(s.grace_minutes) : '10',
    contact_name: s.contact_name || '',
    contact_phone: s.contact_phone || '',
    device_slots: Array.isArray(s.device_slots) ? s.device_slots : [],
  };
}

function InfoTab({ school, canManage, isAdmin, onSaved, onDisabled }) {
  const toast = useToast();
  const [form, setForm] = useState(() => fromSchool(school));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => { setForm(fromSchool(school)); }, [school]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleSlot = (slot) => setForm((f) => ({
    ...f,
    device_slots: f.device_slots.includes(slot)
      ? f.device_slots.filter((s) => s !== slot)
      : [...f.device_slots, slot],
  }));

  const useCurrent = async () => {
    setLocating(true);
    try {
      const pos = await getPosition();
      setForm((f) => ({ ...f, lat: String(pos.lat), lng: String(pos.lng) }));
      toast.ok(`Đã lấy toạ độ hiện tại (sai số ~${pos.accuracy} m).`);
    } catch (e) {
      toast.err(e.howTo ? `${e.message} ${e.howTo}` : e.message);
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    const errs = {};
    if (!form.code.trim()) errs.code = 'Vui lòng nhập mã trường.';
    if (!form.name.trim()) errs.name = 'Vui lòng nhập tên trường.';
    const lat = numOrNull(form.lat);
    const lng = numOrNull(form.lng);
    const radius = numOrNull(form.gps_radius_m);
    const grace = numOrNull(form.grace_minutes);
    if (Number.isNaN(lat)) errs.lat = 'Toạ độ không hợp lệ.';
    if (Number.isNaN(lng)) errs.lng = 'Toạ độ không hợp lệ.';
    if (Number.isNaN(radius)) errs.gps_radius_m = 'Số không hợp lệ.';
    if (Number.isNaN(grace)) errs.grace_minutes = 'Số không hợp lệ.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await api.patch(`/api/schools/${school.id}`, {
        code: form.code.trim(),
        name: form.name.trim(),
        address: form.address.trim() || null,
        province: form.province.trim() || null,
        lat,
        lng,
        gps_radius_m: radius == null ? 1000 : radius,
        grace_minutes: grace == null ? 10 : grace,
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        device_slots: form.device_slots,
      });
      toast.ok('Đã lưu cấu hình trường.');
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setDisabling(true);
    try {
      await api.del(`/api/schools/${school.id}`);
      toast.ok('Đã vô hiệu hoá trường.');
      onDisabled();
    } catch (e) {
      toast.fromError(e);
      setDisabling(false);
      setConfirmOff(false);
    }
  };

  return (
    <div className="card p-4 sm:p-5">
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="Mã trường" required error={errors.code}>
          <input className="input" value={form.code} onChange={set('code')} />
        </Field>
        <Field label="Tên trường" required error={errors.name}>
          <input className="input" value={form.name} onChange={set('name')} />
        </Field>
      </div>
      <Field label="Địa chỉ">
        <input className="input" value={form.address} onChange={set('address')} placeholder="Số nhà, đường, phường/xã" />
      </Field>
      <Field label="Tỉnh / Thành phố">
        <input className="input" value={form.province} onChange={set('province')} placeholder="VD: Bắc Ninh" />
      </Field>

      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Vĩ độ (lat)" error={errors.lat}
          hint="Lấy từ Google Maps: bấm giữ vị trí trường → toạ độ">
          <input className="input" type="number" step="any" value={form.lat} onChange={set('lat')} placeholder="VD: 21.1861" />
        </Field>
        <Field label="Kinh độ (lng)" error={errors.lng}>
          <input className="input" type="number" step="any" value={form.lng} onChange={set('lng')} placeholder="VD: 106.0763" />
        </Field>
      </div>
      <button type="button" className="btn-line w-full mb-3.5" onClick={useCurrent} disabled={locating}>
        {locating ? <Spinner className="h-4 w-4" /> : '🎯'} Dùng vị trí hiện tại
      </button>

      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Bán kính chấm công (m)" error={errors.gps_radius_m} hint="Mặc định 1.000 m (1 km)">
          <input className="input" type="number" value={form.gps_radius_m} onChange={set('gps_radius_m')} />
        </Field>
        <Field label="Phút ân hạn trễ" error={errors.grace_minutes} hint="Mặc định 10 phút">
          <input className="input" type="number" value={form.grace_minutes} onChange={set('grace_minutes')} />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="Người liên hệ">
          <input className="input" value={form.contact_name} onChange={set('contact_name')} />
        </Field>
        <Field label="SĐT liên hệ">
          <input className="input" type="tel" value={form.contact_phone} onChange={set('contact_phone')} />
        </Field>
      </div>

      <Field label="Ca kiểm tra thiết bị" hint="Các khung giờ phòng STEM cần chụp ảnh kiểm tra thiết bị.">
        <div className="grid grid-cols-2 gap-2">
          {SLOT_KEYS.map((slot) => (
            <label key={slot}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13.5px] cursor-pointer transition
                ${form.device_slots.includes(slot)
                  ? 'border-brand-400 bg-brand-50 text-brand-800 font-semibold'
                  : 'border-line text-ink-soft'}`}>
              <input type="checkbox" className="accent-brand-600"
                checked={form.device_slots.includes(slot)}
                onChange={() => toggleSlot(slot)} />
              {LABEL.slot[slot]}
            </label>
          ))}
        </div>
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2.5 mt-4 pt-4 border-t border-line">
        {isAdmin ? (
          <button className="btn-danger" onClick={() => setConfirmOff(true)}>Vô hiệu hoá trường</button>
        ) : <span />}
        {canManage && (
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu thay đổi'}
          </button>
        )}
      </div>

      <ConfirmSheet
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={disable}
        title="Vô hiệu hoá trường"
        danger
        busy={disabling}
        confirmLabel="Vô hiệu hoá"
        message={`Trường "${school.name}" sẽ bị vô hiệu hoá: không còn hiển thị khi xếp lịch, chấm công hay điểm danh. Dữ liệu lịch sử vẫn được giữ nguyên. Bạn chắc chắn chứ?`}
      />
    </div>
  );
}

/* ================================ TAB: LỚP ================================= */

function AddClassSheet({ open, schoolId, onClose, onCreated }) {
  const toast = useToast();
  const EMPTY = { name: '', level: '', grade: '', roster_size: '', note: '' };
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Vui lòng nhập tên lớp.';
    const grade = numOrNull(form.grade);
    const roster = numOrNull(form.roster_size);
    if (Number.isNaN(grade)) errs.grade = 'Số không hợp lệ.';
    if (Number.isNaN(roster)) errs.roster_size = 'Số không hợp lệ.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await api.post('/api/classes', {
        school_id: schoolId,
        name: form.name.trim(),
        level: form.level || null,
        grade,
        roster_size: roster,
        note: form.note.trim() || null,
      });
      toast.ok('Đã thêm lớp mới.');
      setForm(EMPTY);
      setErrors({});
      onCreated();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={saving ? undefined : onClose} title="Thêm lớp">
      <Field label="Tên lớp" required error={errors.name}>
        <input className="input" value={form.name} onChange={set('name')} placeholder="VD: 6A1" />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Cấp học">
          <select className="input" value={form.level} onChange={set('level')}>
            <option value="">— Chọn cấp —</option>
            {Object.entries(LABEL.level).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Khối" error={errors.grade}>
          <input className="input" type="number" value={form.grade} onChange={set('grade')} placeholder="VD: 6" />
        </Field>
      </div>
      <Field label="Sĩ số" error={errors.roster_size}>
        <input className="input" type="number" value={form.roster_size} onChange={set('roster_size')} placeholder="VD: 40" />
      </Field>
      <Field label="Ghi chú">
        <textarea className="input" rows={2} value={form.note} onChange={set('note')} />
      </Field>
      <div className="flex justify-end gap-2.5 mt-2">
        <button className="btn-line" onClick={onClose} disabled={saving}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu lớp'}
        </button>
      </div>
    </Sheet>
  );
}

/** Sheet sửa lớp + phân công GV/TG phụ trách. */
function ClassSheet({ cls, teachers, assistants, canManage, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: cls.name || '',
    level: cls.level || '',
    grade: cls.grade != null ? String(cls.grade) : '',
    roster_size: cls.roster_size != null ? String(cls.roster_size) : '',
    note: cls.note || '',
  });
  const [assigns, setAssigns] = useState(() => (cls.teachers || []).map((t) => ({
    user_id: t.user_id ?? t.id,
    full_name: t.full_name || t.name || `#${t.user_id ?? t.id}`,
    role: t.role || 'teacher',
  })));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const assigned = (id) => assigns.some((a) => String(a.user_id) === String(id));

  const addAssign = (role, users) => (e) => {
    const id = e.target.value;
    if (!id) return;
    const u = users.find((x) => String(x.id) === id);
    if (!u || assigned(u.id)) return;
    setAssigns((xs) => [...xs, { user_id: u.id, full_name: u.full_name, role }]);
  };

  const save = async () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Vui lòng nhập tên lớp.';
    const grade = numOrNull(form.grade);
    const roster = numOrNull(form.roster_size);
    if (Number.isNaN(grade)) errs.grade = 'Số không hợp lệ.';
    if (Number.isNaN(roster)) errs.roster_size = 'Số không hợp lệ.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await api.patch(`/api/classes/${cls.id}`, {
        name: form.name.trim(),
        level: form.level || null,
        grade,
        roster_size: roster,
        note: form.note.trim() || null,
      });
      await api.put(`/api/classes/${cls.id}/assignments`, {
        assignments: assigns.map(({ user_id, role }) => ({ user_id, role })),
      });
      toast.ok('Đã lưu lớp học.');
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={saving ? undefined : onClose} title={`Lớp ${cls.name}`} wide>
      <Field label="Tên lớp" required error={errors.name}>
        <input className="input" value={form.name} onChange={set('name')} />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Cấp học">
          <select className="input" value={form.level} onChange={set('level')}>
            <option value="">— Chọn cấp —</option>
            {Object.entries(LABEL.level).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Khối" error={errors.grade}>
          <input className="input" type="number" value={form.grade} onChange={set('grade')} />
        </Field>
      </div>
      <Field label="Sĩ số" error={errors.roster_size}>
        <input className="input" type="number" value={form.roster_size} onChange={set('roster_size')} />
      </Field>
      <Field label="Ghi chú">
        <textarea className="input" rows={2} value={form.note} onChange={set('note')} />
      </Field>

      <div className="border-t border-line pt-3.5 mt-1">
        <div className="font-bold text-[14px] mb-2">Phân công phụ trách</div>
        {assigns.length === 0 && (
          <div className="text-[13px] text-ink-muted mb-2">Chưa phân công ai cho lớp này.</div>
        )}
        {assigns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {assigns.map((a, i) => (
              <span key={`${a.user_id}-${a.role}`}
                className={`badge ${a.role === 'assistant'
                  ? 'bg-sky-50 text-sky-700 ring-sky-200'
                  : 'bg-brand-50 text-brand-700 ring-brand-200'}`}>
                {a.full_name} · {LABEL.classRole[a.role] || a.role}
                {canManage && (
                  <button type="button" className="ml-0.5 text-[13px] font-bold hover:text-rose-600"
                    aria-label={`Gỡ ${a.full_name}`}
                    onClick={() => setAssigns((xs) => xs.filter((_, j) => j !== i))}>×</button>
                )}
              </span>
            ))}
          </div>
        )}
        {canManage && (
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Thêm giáo viên">
              <select className="input" value="" onChange={addAssign('teacher', teachers)}>
                <option value="">— Chọn GV —</option>
                {teachers.filter((u) => !assigned(u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </Field>
            <Field label="Thêm trợ giảng">
              <select className="input" value="" onChange={addAssign('assistant', assistants)}>
                <option value="">— Chọn TG —</option>
                {assistants.filter((u) => !assigned(u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2.5 mt-2">
        <button className="btn-line" onClick={onClose} disabled={saving}>Đóng</button>
        {canManage && (
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu thay đổi'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ClassesTab({ schoolId, canManage }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [assistants, setAssistants] = useState([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/classes', { school_id: schoolId });
      setList(Array.isArray(res) ? res : res?.items || []);
    } catch (e) {
      setError(e);
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  // Danh sách GV/TG cho phần phân công — nạp một lần khi mở tab.
  useEffect(() => {
    api.get('/api/users', { role: 'teacher', limit: 200 })
      .then((r) => setTeachers(Array.isArray(r) ? r : r?.items || []))
      .catch(() => {});
    api.get('/api/users', { role: 'assistant', limit: 200 })
      .then((r) => setAssistants(Array.isArray(r) ? r : r?.items || []))
      .catch(() => {});
  }, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (list === null) return <PageLoading />;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[13px] text-ink-muted">{fmtNumber(list.length)} lớp</div>
        {canManage && (
          <button className="btn-primary !py-2" onClick={() => setAddOpen(true)}>+ Thêm lớp</button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="👩‍🏫"
          title="Chưa có lớp nào"
          hint="Thêm lớp để phân công giáo viên, trợ giảng và xếp lịch dạy."
          action={canManage && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Thêm lớp</button>
          )}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr>
                <th className="th">Lớp</th>
                <th className="th">Cấp</th>
                <th className="th">Khối</th>
                <th className="th">Sĩ số</th>
                <th className="th">GV / TG phụ trách</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-brand-50/40 cursor-pointer" onClick={() => setEditing(c)}>
                  <td className="td font-semibold text-brand-800">{c.name}</td>
                  <td className="td">{LABEL.level[c.level] || c.level || '—'}</td>
                  <td className="td">{c.grade ?? '—'}</td>
                  <td className="td">{c.roster_size != null ? fmtNumber(c.roster_size) : '—'}</td>
                  <td className="td">
                    {(c.teachers || []).length === 0
                      ? <span className="text-ink-muted">Chưa phân công</span>
                      : (
                        <div className="flex flex-wrap gap-1">
                          {(c.teachers || []).map((t) => (
                            <Badge key={`${t.user_id ?? t.id}-${t.role}`}
                              tone={t.role === 'assistant' ? 'normal' : 'neutral'}>
                              {t.full_name}{t.role ? ` · ${LABEL.classRole[t.role] || t.role}` : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddClassSheet
        open={addOpen}
        schoolId={schoolId}
        onClose={() => setAddOpen(false)}
        onCreated={() => { setAddOpen(false); load(); }}
      />

      {editing && (
        <ClassSheet
          key={editing.id}
          cls={editing}
          teachers={teachers}
          assistants={assistants}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ============================= TAB: PHÒNG STEM ============================= */

/** Sheet thêm (room=null) hoặc sửa/xoá một phòng. */
function RoomSheet({ room, schoolId, canManage, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: room?.name || '', note: room?.note || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) { setErrors({ name: 'Vui lòng nhập tên phòng.' }); return; }
    setErrors({});
    setSaving(true);
    try {
      if (room) {
        await api.patch(`/api/rooms/${room.id}`, {
          name: form.name.trim(),
          note: form.note.trim() || null,
        });
        toast.ok('Đã lưu phòng.');
      } else {
        await api.post('/api/rooms', {
          school_id: schoolId,
          name: form.name.trim(),
          note: form.note.trim() || null,
        });
        toast.ok('Đã thêm phòng mới.');
      }
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/rooms/${room.id}`);
      toast.ok('Đã xoá phòng.');
      onSaved();
    } catch (e) {
      toast.fromError(e);
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  return (
    <Sheet open onClose={saving || deleting ? undefined : onClose}
      title={room ? `Phòng ${room.name}` : 'Thêm phòng STEM'}>
      <Field label="Tên phòng" required error={errors.name}>
        <input className="input" value={form.name} onChange={set('name')} placeholder="VD: Phòng STEM tầng 2" />
      </Field>
      <Field label="Ghi chú">
        <textarea className="input" rows={2} value={form.note} onChange={set('note')}
          placeholder="VD: Dãy nhà B, có 20 bộ UBTECH" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mt-2">
        {room && canManage ? (
          <button className="btn-danger" onClick={() => setConfirmDel(true)} disabled={saving}>Xoá phòng</button>
        ) : <span />}
        <div className="flex gap-2.5">
          <button className="btn-line" onClick={onClose} disabled={saving || deleting}>Huỷ</button>
          {canManage && (
            <button className="btn-primary" onClick={save} disabled={saving || deleting}>
              {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : room ? 'Lưu thay đổi' : 'Lưu phòng'}
            </button>
          )}
        </div>
      </div>

      {room && (
        <ConfirmSheet
          open={confirmDel}
          onClose={() => setConfirmDel(false)}
          onConfirm={remove}
          title="Xoá phòng STEM"
          danger
          busy={deleting}
          confirmLabel="Xoá phòng"
          message={`Xoá phòng "${room.name}"? Lịch sử kiểm tra thiết bị của phòng vẫn được giữ nguyên.`}
        />
      )}
    </Sheet>
  );
}

function RoomsTab({ schoolId, canManage }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/rooms', { school_id: schoolId });
      setList(Array.isArray(res) ? res : res?.items || []);
    } catch (e) {
      setError(e);
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (list === null) return <PageLoading />;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[13px] text-ink-muted">{fmtNumber(list.length)} phòng</div>
        {canManage && (
          <button className="btn-primary !py-2" onClick={() => setAddOpen(true)}>+ Thêm phòng</button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="🧪"
          title="Chưa có phòng STEM"
          hint="Thêm phòng để giáo viên chụp ảnh kiểm tra thiết bị đầu/cuối buổi."
          action={canManage && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Thêm phòng</button>
          )}
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((r) => (
            <button key={r.id} type="button" onClick={() => setEditing(r)}
              className="card w-full text-left p-4 hover:border-brand-300 hover:shadow-card transition">
              <div className="font-bold text-[14.5px]">🧪 {r.name}</div>
              {r.note && <div className="text-[13px] text-ink-muted mt-1 truncate">{r.note}</div>}
            </button>
          ))}
        </div>
      )}

      {addOpen && (
        <RoomSheet
          room={null}
          schoolId={schoolId}
          canManage={canManage}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); load(); }}
        />
      )}
      {editing && (
        <RoomSheet
          key={editing.id}
          room={editing}
          schoolId={schoolId}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------- Màn hình chính ----------------------------- */
export default function SchoolDetail() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [tab, setTab] = useState('info');
  const [school, setSchool] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get(`/api/schools/${schoolId}`);
      setSchool(res);
    } catch (e) {
      setError(e);
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  if (error && !school) return <div className="pt-2"><ErrorBox error={error} onRetry={load} /></div>;
  if (!school) return <PageLoading />;

  const canManage = auth.can('org.manage');

  return (
    <div>
      <PageHeader
        title={school.name}
        sub={`Mã: ${school.code}${school.province ? ` · ${school.province}` : ''}`}
        actions={
          <button className="btn-line !py-1.5" onClick={() => navigate('/to-chuc')}>← Danh sách</button>
        }
      />

      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'info', label: 'Thông tin' },
          { value: 'classes', label: 'Lớp' },
          { value: 'rooms', label: 'Phòng STEM' },
        ]}
      />

      {tab === 'info' && (
        <InfoTab
          school={school}
          canManage={canManage}
          isAdmin={auth.isAdmin}
          onSaved={load}
          onDisabled={() => navigate('/to-chuc')}
        />
      )}
      {tab === 'classes' && <ClassesTab schoolId={schoolId} canManage={canManage} />}
      {tab === 'rooms' && <RoomsTab schoolId={schoolId} canManage={canManage} />}
    </div>
  );
}
