/**
 * OrgHome.jsx — Trường & Lớp (route /to-chuc, quyền org.manage).
 *
 * Danh sách trường có tìm kiếm; mỗi thẻ trường hiển thị mã, địa chỉ, số lớp/phòng
 * và trạng thái cấu hình GPS. Thêm trường mới qua Sheet, có nút lấy vị trí hiện tại.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtNumber } from '../../lib/format.js';
import { getPosition } from '../../lib/gps.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading, Pager, SearchBox, Sheet, Spinner,
} from '../../components/ui.jsx';

const LIMIT = 50;

const EMPTY_FORM = {
  code: '', name: '', address: '', province: '',
  lat: '', lng: '', gps_radius_m: '1000', grace_minutes: '10',
  contact_name: '', contact_phone: '',
};

/** '' → null; số hợp lệ → Number; sai định dạng → NaN (để báo lỗi). */
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* -------------------------------- Thẻ trường ------------------------------- */
function SchoolCard({ school, onOpen }) {
  const hasGps = school.lat != null && school.lng != null;
  return (
    <button type="button" onClick={onOpen}
      className="card w-full text-left p-4 hover:border-brand-300 hover:shadow-card transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-[15px] text-ink truncate">{school.name}</div>
          <div className="text-[12.5px] text-ink-muted mt-0.5">
            Mã: <span className="font-semibold text-brand-700">{school.code}</span>
          </div>
        </div>
        {hasGps
          ? <Badge tone="approved">📍 GPS đã cấu hình</Badge>
          : <Badge tone="pending">📍 Chưa có toạ độ GPS</Badge>}
      </div>
      {(school.address || school.province) && (
        <div className="text-[13px] text-ink-soft mt-2 truncate">
          {[school.address, school.province].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="text-[12.5px] text-ink-muted mt-1.5">
        🏫 {fmtNumber(school.classes_count || 0)} lớp · 🧪 {fmtNumber(school.rooms_count || 0)} phòng STEM
      </div>
    </button>
  );
}

/* ----------------------------- Sheet thêm trường ---------------------------- */
function AddSchoolSheet({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

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

  const submit = async () => {
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
      await api.post('/api/schools', {
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
      });
      toast.ok('Đã thêm trường mới.');
      setForm(EMPTY_FORM);
      setErrors({});
      onCreated();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={saving ? undefined : onClose} title="Thêm trường" wide>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label="Mã trường" required error={errors.code}>
          <input className="input" value={form.code} onChange={set('code')} placeholder="VD: THCS-NT01" />
        </Field>
        <Field label="Tên trường" required error={errors.name}>
          <input className="input" value={form.name} onChange={set('name')} placeholder="VD: THCS Nguyễn Trãi" />
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
          <input className="input" value={form.contact_name} onChange={set('contact_name')} placeholder="VD: Cô Hoa — Hiệu phó" />
        </Field>
        <Field label="SĐT liên hệ">
          <input className="input" type="tel" value={form.contact_phone} onChange={set('contact_phone')} placeholder="VD: 0912 345 678" />
        </Field>
      </div>

      <div className="flex justify-end gap-2.5 mt-2">
        <button className="btn-line" onClick={onClose} disabled={saving}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu trường'}
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------- Màn hình chính ----------------------------- */
export default function OrgHome() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/api/schools', { q, page, limit: LIMIT });
      setData(res);
    } catch (e) {
      setError(e);
    }
  }, [q, page]);

  useEffect(() => { load(); }, [load]);

  const items = Array.isArray(data) ? data : data?.items || [];
  const total = Array.isArray(data) ? data.length : data?.total || 0;
  const canManage = auth.can('org.manage');

  return (
    <div>
      <PageHeader
        title="Trường & Lớp"
        sub="Cấu hình trường, lớp học và phòng STEM"
        actions={canManage && (
          <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Thêm trường</button>
        )}
      />

      <SearchBox
        value={q}
        onChange={(v) => { setQ(v); setPage(1); }}
        placeholder="Tìm theo tên hoặc mã trường…"
        className="mb-4"
      />

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && data === null && <PageLoading />}

      {!error && data !== null && (items.length === 0 ? (
        <EmptyState
          icon="🏫"
          title={q ? 'Không tìm thấy trường phù hợp' : 'Chưa có trường nào'}
          hint={q
            ? 'Thử từ khoá khác, ví dụ tên viết tắt hoặc mã trường.'
            : 'Thêm trường đầu tiên để bắt đầu cấu hình lớp học và lịch dạy.'}
          action={canManage && !q && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Thêm trường</button>
          )}
        />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            {items.map((s) => (
              <SchoolCard key={s.id} school={s} onOpen={() => navigate(`/to-chuc/${s.id}`)} />
            ))}
          </div>
          <Pager page={page} limit={LIMIT} total={total} onPage={setPage} />
        </>
      ))}

      <AddSchoolSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => { setAddOpen(false); load(); }}
      />
    </div>
  );
}
