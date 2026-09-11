/**
 * UsersAdmin.jsx — Quản lý tài khoản người dùng (chỉ admin) — route /tai-khoan.
 *
 * - Lọc theo vai trò / từ khoá / trạng thái hoạt động (GET /api/users).
 * - Tạo tài khoản: server sinh mật khẩu tạm và gửi email; nếu SMTP chưa cấu hình
 *   (email_sent=false) thì hiển thị mật khẩu tạm để admin gửi qua kênh khác.
 * - Chi tiết: sửa thông tin, cấp lại mật khẩu, khoá/mở khoá, gán trường phụ trách
 *   cho Phòng chuyên môn, xem lịch dạy của giáo viên/trợ giảng.
 * - Không cho tự khoá tài khoản của chính mình (ẩn nút).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtAgo, fmtDate, fmtNumber, fmtRange, LABEL, initials } from '../../lib/format.js';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Pager, SearchBox, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const LIMIT = 50;

const ROLE_FILTER = [
  { value: '', label: 'Tất cả' },
  { value: 'admin', label: 'Quản trị' },
  { value: 'manager', label: 'Phòng CM' },
  { value: 'teacher', label: 'Giáo viên' },
  { value: 'assistant', label: 'Trợ giảng' },
];

/** Ánh xạ vai trò / trạng thái buổi dạy → khoá màu TONE trong format.js. */
const ROLE_TONE = { admin: 'neutral', manager: 'new', teacher: 'resolved', assistant: 'low' };
const SCHEDULE_TONE = { scheduled: 'normal', done: 'resolved', cancelled: 'absent' };

const lastLoginText = (u) => {
  const at = u?.last_login_at || u?.last_login;
  return at ? fmtAgo(at) : 'Chưa đăng nhập';
};

/* --------------------------- Thành phần nhỏ dùng chung --------------------------- */

function Avatar({ name, className = 'h-10 w-10 text-[15px]' }) {
  return (
    <span className={`${className} shrink-0 rounded-full bg-brand-grad-soft text-white grid place-items-center font-bold`}>
      {initials(name)}
    </span>
  );
}

function RoleBadge({ role }) {
  return <Badge tone={ROLE_TONE[role] || 'neutral'}>{LABEL.role[role] || role || '—'}</Badge>;
}

function StatusBadge({ active }) {
  return active
    ? <Badge tone="approved">Hoạt động</Badge>
    : <Badge tone="rejected">Đã khoá</Badge>;
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/70 pb-2">
      <span className="text-[13px] text-ink-muted shrink-0 pt-0.5">{label}</span>
      <span className="text-[14px] font-medium text-right break-all">{value}</span>
    </div>
  );
}

/** Danh sách trường dạng checkbox — dùng khi tạo mới và khi sửa phạm vi manager. */
function SchoolChecklist({ schools, loading, selected, onToggle, onRetry }) {
  if (loading) {
    return <div className="py-4 text-center"><Spinner /></div>;
  }
  if (schools === null) {
    return (
      <div className="text-[13px] text-ink-muted py-2">
        Chưa tải được danh sách trường.{' '}
        {onRetry && (
          <button type="button" className="text-brand-700 font-semibold hover:underline" onClick={onRetry}>
            Thử lại
          </button>
        )}
      </div>
    );
  }
  if (!schools.length) {
    return <div className="text-[13px] text-ink-muted py-2">Chưa có trường nào trong hệ thống.</div>;
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line/70">
      {schools.map((s) => (
        <label key={s.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[14px] cursor-pointer hover:bg-canvas">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600 shrink-0"
            checked={selected.includes(s.id)}
            onChange={() => onToggle(s.id)}
          />
          <span className="min-w-0 truncate">{s.name}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------ Chọn khu vực (+ thêm mới) ------------------------ */
function RegionSelect({ value, onChange, canAdd }) {
  const toast = useToast();
  const [regions, setRegions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const load = () => api.get('/api/regions')
    .then((d) => setRegions(d?.items || []))
    .catch(() => setRegions([]));
  useEffect(() => { load(); }, []);

  const add = async () => {
    const v = name.trim();
    if (!v) return;
    try {
      const rg = await api.post('/api/regions', { name: v });
      toast.ok(`Đã thêm khu vực "${rg.name}".`);
      setName(''); setAdding(false);
      await load();
      onChange(rg.id);
    } catch (e) { toast.fromError(e); }
  };

  return (
    <>
      <div className="flex gap-2">
        <select className="input flex-1" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Chọn khu vực —</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {canAdd && !adding && (
          <button type="button" className="btn-line !px-3 shrink-0" onClick={() => setAdding(true)}>+ Khu vực</button>
        )}
      </div>
      {adding && (
        <div className="flex gap-2 mt-2">
          <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Tên khu vực mới, ví dụ: Bắc Ninh" autoFocus />
          <button type="button" className="btn-primary !px-3" onClick={add}>Thêm</button>
          <button type="button" className="btn-line !px-3" onClick={() => setAdding(false)}>Huỷ</button>
        </div>
      )}
    </>
  );
}

/* ------------------------- Sheet hiển thị mật khẩu tạm ------------------------- */

function TempPasswordSheet({ result, onClose }) {
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temp_password);
      toast.ok('Đã sao chép mật khẩu tạm.');
    } catch {
      toast.err('Không sao chép tự động được — hãy bôi đen mật khẩu và sao chép thủ công.');
    }
  };

  return (
    <Sheet open={!!result} onClose={onClose} title="Mật khẩu tạm">
      {result && (
        <>
          <p className="text-[14px] text-ink-soft mb-3">
            Mật khẩu tạm của tài khoản <b>{result.email}</b>:
          </p>
          <div className="rounded-xl2 border-2 border-dashed border-brand-300 bg-brand-50 px-4 py-5 text-center mb-3">
            <div className="font-mono text-[26px] font-extrabold tracking-[0.15em] text-brand-800 select-all break-all">
              {result.temp_password}
            </div>
          </div>
          <button className="btn-primary w-full mb-3" onClick={copy}>📋 Sao chép</button>
          <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3.5 py-2.5">
            ⚠ SMTP chưa cấu hình — hãy gửi mật khẩu này cho người dùng qua kênh khác
            (Zalo, tin nhắn…). Người dùng sẽ phải đổi mật khẩu ngay lần đăng nhập đầu tiên.
          </div>
          <button className="btn-line w-full mt-3" onClick={onClose}>Đóng</button>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------ Sheet tạo tài khoản ------------------------------ */

function CreateUserSheet({ open, onClose, schools, schoolsLoading, ensureSchools, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: '', region_id: '', birth_date: '' });
  const [schoolIds, setSchoolIds] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ full_name: '', email: '', phone: '', role: '', region_id: '', birth_date: '' });
      setSchoolIds([]);
      setErrors({});
    }
  }, [open]);

  // Chỉ khi chọn vai trò Phòng CM mới cần danh sách trường.
  useEffect(() => {
    if (open && form.role === 'manager') ensureSchools();
  }, [open, form.role, ensureSchools]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleSchool = (id) =>
    setSchoolIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    if (!form.full_name.trim()) errs.full_name = 'Vui lòng nhập họ tên.';
    if (!form.email.trim()) errs.email = 'Vui lòng nhập email.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Email không hợp lệ.';
    if (!form.role) errs.role = 'Vui lòng chọn vai trò.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const email = form.email.trim().toLowerCase();
      const body = {
        full_name: form.full_name.trim(),
        email,
        phone: form.phone.trim() || undefined,
        role: form.role,
      };
      if (form.role === 'manager') body.school_ids = schoolIds;
      if (form.region_id) body.region_id = form.region_id;
      if (form.birth_date) body.birth_date = form.birth_date;
      const res = await api.post('/api/users', body);
      onCreated(res, email);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Tạo tài khoản">
      <form onSubmit={submit} noValidate>
        <Field label="Họ và tên" required error={errors.full_name}>
          <input className="input" value={form.full_name} onChange={set('full_name')} placeholder="Nguyễn Văn A" autoFocus />
        </Field>
        <Field label="Email" required error={errors.email} hint="Hệ thống sẽ gửi mật khẩu tạm tới email này.">
          <input className="input" type="email" inputMode="email" value={form.email} onChange={set('email')} placeholder="ten@gmail.com" />
        </Field>
        <Field label="Số điện thoại">
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="09xx xxx xxx" />
        </Field>
        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Khu vực" hint="Hiển thị trên danh sách để nhận biết địa bàn.">
            <RegionSelect
              value={form.region_id}
              onChange={(v) => setForm((f) => ({ ...f, region_id: v }))}
              canAdd
            />
          </Field>
          <Field label="Ngày sinh">
            <input className="input" type="date" value={form.birth_date}
              onChange={set('birth_date')} max="2015-12-31" />
          </Field>
        </div>
        <Field label="Vai trò" required error={errors.role}>
          <select className="input" value={form.role} onChange={set('role')}>
            <option value="">— Chọn vai trò —</option>
            {Object.entries(LABEL.role).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        {form.role === 'manager' && (
          <Field
            label="Trường phụ trách"
            hint="Phòng chuyên môn chỉ thấy dữ liệu của các trường được chọn. Có thể bổ sung sau.">
            <SchoolChecklist
              schools={schools}
              loading={schoolsLoading}
              selected={schoolIds}
              onToggle={toggleSchool}
              onRetry={ensureSchools}
            />
          </Field>
        )}

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Tạo tài khoản'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------ Sheet sửa thông tin ------------------------------ */

function EditUserSheet({ open, onClose, user, isSelf, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', phone: '', role: 'teacher', region_id: '', birth_date: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && user) {
      setForm({
        full_name: user.full_name || '', phone: user.phone || '', role: user.role || 'teacher',
        region_id: user.region_id || '',
        birth_date: user.birth_date ? String(user.birth_date).slice(0, 10) : '',
      });
    }
  }, [open, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.full_name.trim()) {
      toast.err('Họ tên không được để trống.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/users/${user.id}`, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        role: form.role,
        region_id: form.region_id || null,
        birth_date: form.birth_date || null,
      });
      toast.ok('Đã cập nhật thông tin.');
      onSaved();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Sửa thông tin">
      <form onSubmit={submit} noValidate>
        <Field label="Họ và tên" required>
          <input className="input" value={form.full_name} onChange={set('full_name')} />
        </Field>
        <Field label="Số điện thoại">
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Khu vực">
            <RegionSelect
              value={form.region_id}
              onChange={(v) => setForm((f) => ({ ...f, region_id: v }))}
              canAdd
            />
          </Field>
          <Field label="Ngày sinh">
            <input className="input" type="date" value={form.birth_date} onChange={set('birth_date')} />
          </Field>
        </div>
        <Field
          label="Vai trò"
          required
          hint={isSelf
            ? 'Không thể tự đổi vai trò của chính mình.'
            : (form.role === 'manager' ? 'Nhớ gán trường phụ trách sau khi lưu.' : undefined)}>
          <select className="input" value={form.role} onChange={set('role')} disabled={isSelf}>
            {Object.entries(LABEL.role).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* --------------------- Sheet gán trường phụ trách cho manager --------------------- */

function ManagerSchoolsSheet({ open, onClose, user, schools, schoolsLoading, ensureSchools, onSaved }) {
  const toast = useToast();
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && user) {
      setIds((user.schools || []).map((s) => s.id));
      ensureSchools();
    }
  }, [open, user, ensureSchools]);

  const toggle = (id) =>
    setIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put(`/api/users/${user.id}/schools`, { school_ids: ids });
      toast.ok('Đã cập nhật trường phụ trách.');
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Trường phụ trách">
      <SchoolChecklist
        schools={schools}
        loading={schoolsLoading}
        selected={ids}
        onToggle={toggle}
        onRetry={ensureSchools}
      />
      <div className="text-[12px] text-ink-muted mt-2">
        Phòng chuyên môn chỉ thấy dữ liệu của các trường được chọn.
      </div>
      <div className="flex gap-2.5 justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu'}
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------- Sheet xem lịch dạy cá nhân --------------------------- */

function ScheduleSheet({ open, onClose, user }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);
    setError(null);
    try {
      const res = await api.get(`/api/users/${user.id}/schedule`);
      setItems(Array.isArray(res) ? res : res?.items || []);
    } catch (e) {
      setError(e);
    }
  }, [user]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const rows = (items || []).slice(0, 20);

  return (
    <Sheet open={open} onClose={onClose} title={`Lịch dạy — ${user?.full_name || ''}`} wide>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && items === null && <PageLoading label="Đang tải lịch dạy…" />}
      {!error && items !== null && (
        items.length === 0 ? (
          <EmptyState
            icon="🗓️"
            title="Chưa có buổi dạy nào"
            hint="Phân công lịch cho người này ở mục Lịch dạy."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Ngày</th>
                    <th className="th">Giờ</th>
                    <th className="th">Lớp</th>
                    <th className="th">Trường</th>
                    <th className="th">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id}>
                      <td className="td whitespace-nowrap">{fmtDate(it.session_date || it.date)}</td>
                      <td className="td whitespace-nowrap">{fmtRange(it.start_time, it.end_time)}</td>
                      <td className="td">{it.class_name || it.class?.name || '—'}</td>
                      <td className="td">{it.school_name || it.school?.name || '—'}</td>
                      <td className="td">
                        <Badge tone={SCHEDULE_TONE[it.status] || 'neutral'}>
                          {LABEL.scheduleStatus[it.status] || it.status || '—'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.length > rows.length && (
              <div className="text-[12px] text-ink-muted mt-2 text-center">
                Hiển thị {rows.length}/{items.length} buổi — xem đầy đủ ở mục Lịch dạy.
              </div>
            )}
          </>
        )
      )}
    </Sheet>
  );
}

/* =============================== Màn hình chính =============================== */

export default function UsersAdmin() {
  const auth = useAuth();
  const toast = useToast();

  /* ------------------------------ Bộ lọc + danh sách ------------------------------ */
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/users', {
        q, role, is_active: onlyActive ? 'true' : '', page, limit: LIMIT,
      });
      if (seq.current !== my) return;
      setData(res);
    } catch (e) {
      if (seq.current !== my) return;
      setError(e);
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }, [q, role, onlyActive, page]);

  useEffect(() => { load(); }, [load]);

  const resetToFirstPage = () => setPage(1);

  /* -------------------------- Danh sách trường (tải 1 lần) -------------------------- */
  const [schools, setSchools] = useState(null);       // null = chưa tải / tải lỗi
  const [schoolsLoading, setSchoolsLoading] = useState(false);

  const ensureSchools = useCallback(async () => {
    if (schools !== null || schoolsLoading) return;
    setSchoolsLoading(true);
    try {
      const res = await api.get('/api/schools', { limit: 200 });
      setSchools(Array.isArray(res) ? res : res?.items || []);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSchoolsLoading(false);
    }
  }, [schools, schoolsLoading, toast]);

  /* ------------------------------ Chi tiết người dùng ------------------------------ */
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await api.get(`/api/users/${id}`);
      // Server trả { user, schools, classes } — giao diện đọc phẳng (detail.email,
      // detail.is_active…) nên phải trải phẳng, nếu không toàn bộ ô sẽ trống và
      // trạng thái hiện sai thành "Đã khoá".
      setDetail(d?.user ? { ...d.user, schools: d.schools || [], classes: d.classes || [] } : d);
    } catch (e) {
      setDetailError(e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openUser = (u) => {
    setSelectedId(u.id);
    setDetail(u);              // hiện ngay dữ liệu dòng, sau đó nạp bản đầy đủ
    loadDetail(u.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  };

  const refreshAfterChange = () => {
    load();
    if (selectedId) loadDetail(selectedId);
  };

  const isSelf = !!detail && detail.id === auth.user?.id;
  const isFieldRole = detail?.role === 'teacher' || detail?.role === 'assistant';

  /* ------------------------------ Các sheet thao tác ------------------------------ */
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [schoolsOpen, setSchoolsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [lockConfirm, setLockConfirm] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [tempResult, setTempResult] = useState(null);   // { email, temp_password }

  const onCreated = (res, email) => {
    setCreateOpen(false);
    if (page !== 1) setPage(1);
    else load();
    if (res?.email_sent === false && res?.temp_password) {
      setTempResult({ email, temp_password: res.temp_password });
    } else if (res?.email_sent) {
      toast.ok('Đã gửi email cấp tài khoản.');
    } else {
      toast.ok('Đã tạo tài khoản.');
    }
  };

  const doResetPassword = async () => {
    if (!detail || resetBusy) return;
    setResetBusy(true);
    try {
      const res = await api.post(`/api/users/${detail.id}/reset-password`);
      setResetConfirm(false);
      if (res?.email_sent === false && res?.temp_password) {
        setTempResult({ email: detail.email, temp_password: res.temp_password });
      } else if (res?.email_sent) {
        toast.ok('Đã gửi email mật khẩu mới cho người dùng.');
      } else {
        toast.ok('Đã cấp lại mật khẩu.');
      }
    } catch (e) {
      toast.fromError(e);
    } finally {
      setResetBusy(false);
    }
  };

  const doToggleLock = async () => {
    if (!detail || lockBusy) return;
    setLockBusy(true);
    try {
      await api.patch(`/api/users/${detail.id}`, { is_active: !detail.is_active });
      toast.ok(detail.is_active ? 'Đã khoá tài khoản.' : 'Đã mở khoá tài khoản.');
      setLockConfirm(false);
      refreshAfterChange();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setLockBusy(false);
    }
  };

  const doDelete = async () => {
    if (!detail || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/users/${detail.id}`, { query: { hard: 1 } });
      toast.ok(`Đã xoá hẳn tài khoản ${detail.email}. Email này dùng lại được.`);
      setDeleteConfirm(false);
      setSelectedId(null);          // đóng bảng chi tiết vì bản ghi không còn
      load();
    } catch (e) {
      // 422 = tài khoản đã phát sinh dữ liệu; server nói rõ dữ liệu gì.
      toast.fromError(e);
      setDeleteConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  /* ----------------------------------- Render ----------------------------------- */
  const items = data?.items || [];

  return (
    <>
      <PageHeader
        title="Tài khoản"
        sub={data ? `${fmtNumber(data.total)} tài khoản trong hệ thống` : 'Quản lý người dùng hệ thống'}
        actions={auth.can('users.manage') && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ Tạo tài khoản</button>
        )}
      />

      {/* Bộ lọc */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 mb-4">
        <SearchBox
          value={q}
          onChange={(v) => { setQ(v); resetToFirstPage(); }}
          placeholder="Tìm theo tên, email…"
          className="sm:w-64"
        />
        <Segmented
          options={ROLE_FILTER}
          value={role}
          onChange={(v) => { setRole(v); resetToFirstPage(); }}
        />
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-soft cursor-pointer select-none sm:ml-auto">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={onlyActive}
            onChange={(e) => { setOnlyActive(e.target.checked); resetToFirstPage(); }}
          />
          Đang hoạt động
        </label>
      </div>

      {loading && !data && <PageLoading />}
      {error && !data && <ErrorBox error={error} onRetry={load} />}

      {data && (
        <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
          {items.length === 0 ? (
            <EmptyState
              icon="👥"
              title="Không tìm thấy tài khoản"
              hint={q || role || onlyActive
                ? 'Thử xoá bớt bộ lọc hoặc tìm từ khoá khác.'
                : 'Bấm "+ Tạo tài khoản" để cấp tài khoản đầu tiên.'}
              action={!q && !role && !onlyActive && (
                <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ Tạo tài khoản</button>
              )}
            />
          ) : (
            <>
              {/* Bảng desktop */}
              <div className="hidden md:block card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="th">Người dùng</th>
                        <th className="th">SĐT</th>
                        <th className="th">Vai trò</th>
                        <th className="th">Khu vực</th>
                        <th className="th">Trạng thái</th>
                        <th className="th">Đăng nhập gần nhất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((u) => (
                        <tr key={u.id} className="cursor-pointer hover:bg-brand-50/40 transition" onClick={() => openUser(u)}>
                          <td className="td">
                            <div className="flex items-center gap-3 min-w-[220px]">
                              <Avatar name={u.full_name} />
                              <div className="min-w-0">
                                <div className="font-semibold truncate">{u.full_name}</div>
                                <div className="text-[12.5px] text-ink-muted truncate">
                                  {u.email}{u.birth_date ? ` · 🎂 ${fmtDate(u.birth_date)}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="td whitespace-nowrap">{u.phone || '—'}</td>
                          <td className="td"><RoleBadge role={u.role} /></td>
                          <td className="td whitespace-nowrap">
                            {u.region_name ? `📍 ${u.region_name}` : '—'}
                          </td>
                          <td className="td"><StatusBadge active={u.is_active} /></td>
                          <td className="td whitespace-nowrap text-ink-muted">{lastLoginText(u)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Danh sách thẻ mobile */}
              <div className="md:hidden grid gap-2">
                {items.map((u) => (
                  <button key={u.id} onClick={() => openUser(u)} className="card w-full text-left px-4 py-3 flex items-center gap-3">
                    <Avatar name={u.full_name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{u.full_name}</div>
                      <div className="text-[12.5px] text-ink-muted truncate">
                        {u.email}{u.phone ? ` · ${u.phone}` : ''}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <RoleBadge role={u.role} />
                        <StatusBadge active={u.is_active} />
                      </div>
                    </div>
                    <div className="text-[11px] text-ink-muted shrink-0 text-right max-w-[84px]">
                      {lastLoginText(u)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />
        </div>
      )}

      {/* ------------------------------ Sheet chi tiết ------------------------------ */}
      <Sheet open={!!selectedId} onClose={closeDetail} title="Chi tiết tài khoản" wide>
        {detail && (
          <>
            <div className="flex items-center gap-3.5 mb-4">
              <Avatar name={detail.full_name} className="h-14 w-14 text-xl" />
              <div className="min-w-0">
                <div className="font-bold text-[16px] truncate">{detail.full_name}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <RoleBadge role={detail.role} />
                  <StatusBadge active={detail.is_active} />
                  {isSelf && <Badge tone="neutral">Tài khoản của bạn</Badge>}
                </div>
              </div>
            </div>

            {detailError && (
              <div className="mb-3">
                <ErrorBox error={detailError} onRetry={() => loadDetail(detail.id)} />
              </div>
            )}

            <div className="grid gap-2 mb-4">
              <InfoRow label="Email" value={detail.email} />
              <InfoRow label="Số điện thoại" value={detail.phone || '—'} />
              <InfoRow label="Đăng nhập gần nhất" value={lastLoginText(detail)} />
              {detail.created_at && <InfoRow label="Ngày tạo" value={fmtDate(detail.created_at)} />}
            </div>

            {detail.role === 'manager' && (
              <div className="mb-4">
                <div className="label">Trường phụ trách</div>
                {detailLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (detail.schools || []).length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.schools.map((s) => <Badge key={s.id} tone="neutral">🏫 {s.name}</Badge>)}
                  </div>
                ) : (
                  <div className="text-[13px] text-ink-muted">Chưa gán trường nào — bấm "Trường phụ trách" để gán.</div>
                )}
              </div>
            )}

            {isFieldRole && (
              <div className="mb-4">
                <div className="label">Lớp phụ trách</div>
                {detailLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (detail.classes || []).length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.classes.map((c) => (
                      <Badge key={c.id} tone="new">
                        {c.name}{(c.school_name || c.school?.name) ? ` · ${c.school_name || c.school?.name}` : ''}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-ink-muted">Chưa được phân công lớp nào.</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button className="btn-line" disabled={detailLoading} onClick={() => setEditOpen(true)}>
                ✏️ Sửa
              </button>
              <button className="btn-line" onClick={() => setResetConfirm(true)}>
                🔑 Cấp lại mật khẩu
              </button>
              {detail.role === 'manager' && (
                <button className="btn-line" disabled={detailLoading} onClick={() => setSchoolsOpen(true)}>
                  🏫 Trường phụ trách
                </button>
              )}
              {isFieldRole && (
                <button className="btn-line" onClick={() => setScheduleOpen(true)}>
                  🗓️ Xem lịch dạy
                </button>
              )}
              {!isSelf && (detail.is_active ? (
                <button className="btn-danger col-span-2" onClick={() => setLockConfirm(true)}>
                  🔒 Khoá tài khoản
                </button>
              ) : (
                <button className="btn-primary col-span-2" onClick={() => setLockConfirm(true)}>
                  🔓 Mở khoá tài khoản
                </button>
              ))}
              {!isSelf && (
                <button
                  className="btn-line col-span-2 !text-rose-700 !border-rose-200 hover:!border-rose-400"
                  onClick={() => setDeleteConfirm(true)}>
                  🗑️ Xoá hẳn tài khoản
                </button>
              )}
            </div>
            {!isSelf && (
              <p className="text-[12px] text-ink-muted mt-2 leading-relaxed">
                <b>Khoá</b> giữ lại toàn bộ dữ liệu chấm công, người dùng chỉ không đăng nhập được.
                <b> Xoá hẳn</b> dùng khi tạo nhầm — chỉ thực hiện được nếu tài khoản chưa phát sinh
                dữ liệu nào, và sau đó email được giải phóng để tạo lại.
              </p>
            )}
          </>
        )}
      </Sheet>

      {/* ------------------------------ Các sheet phụ ------------------------------ */}
      <CreateUserSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        schools={schools}
        schoolsLoading={schoolsLoading}
        ensureSchools={ensureSchools}
        onCreated={onCreated}
      />

      <EditUserSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={detail}
        isSelf={isSelf}
        onSaved={() => { setEditOpen(false); refreshAfterChange(); }}
      />

      <ManagerSchoolsSheet
        open={schoolsOpen}
        onClose={() => setSchoolsOpen(false)}
        user={detail}
        schools={schools}
        schoolsLoading={schoolsLoading}
        ensureSchools={ensureSchools}
        onSaved={() => { setSchoolsOpen(false); refreshAfterChange(); }}
      />

      <ScheduleSheet open={scheduleOpen} onClose={() => setScheduleOpen(false)} user={detail} />

      <ConfirmSheet
        open={resetConfirm}
        onClose={() => setResetConfirm(false)}
        onConfirm={doResetPassword}
        busy={resetBusy}
        title="Cấp lại mật khẩu"
        confirmLabel="Cấp lại"
        message={`Cấp lại mật khẩu tạm cho "${detail?.full_name || ''}"? Mật khẩu hiện tại sẽ mất hiệu lực và người dùng phải đổi mật khẩu ở lần đăng nhập kế tiếp.`}
      />

      <ConfirmSheet
        open={lockConfirm}
        onClose={() => setLockConfirm(false)}
        onConfirm={doToggleLock}
        busy={lockBusy}
        danger={!!detail?.is_active}
        title={detail?.is_active ? 'Khoá tài khoản' : 'Mở khoá tài khoản'}
        confirmLabel={detail?.is_active ? 'Khoá' : 'Mở khoá'}
        message={detail?.is_active
          ? `Khoá tài khoản "${detail?.full_name || ''}"? Người dùng sẽ không thể đăng nhập cho tới khi được mở khoá.`
          : `Mở khoá tài khoản "${detail?.full_name || ''}"? Người dùng sẽ đăng nhập lại được ngay.`}
      />

      <ConfirmSheet
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={doDelete}
        busy={deleteBusy}
        danger
        title="Xoá hẳn tài khoản"
        confirmLabel="Xoá hẳn"
        message={`Xoá hẳn tài khoản "${detail?.full_name || ''}" (${detail?.email || ''})? `
          + 'Thao tác này không hoàn tác được. Nếu tài khoản đã từng chấm công, điểm danh hay '
          + 'đăng học liệu thì hệ thống sẽ từ chối để bảo vệ số liệu — khi đó hãy dùng "Khoá tài khoản".'}
      />

      <TempPasswordSheet result={tempResult} onClose={() => setTempResult(null)} />
    </>
  );
}
