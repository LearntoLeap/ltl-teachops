/**
 * StaffDirectory.jsx — CSDL Giáo viên & Trợ giảng (route /nhan-su).
 *
 * Khác trang "Tài khoản" (chỉ Quản trị viên, thiên về cấp/khoá tài khoản):
 * đây là DANH BẠ NHÂN SỰ ĐỨNG LỚP để Phòng chuyên môn mở ra hằng ngày —
 * ai đang phụ trách trường nào, liên lạc thế nào, dạy bao nhiêu buổi tháng này.
 * Phòng chuyên môn xem được (users.view); sửa hồ sơ vẫn thuộc Quản trị viên.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtAgo, fmtDate, fmtNumber, initials, LABEL } from '../../lib/format.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, EmptyState, ErrorBox, Field, PageHeader, PageLoading, Pager, SearchBox, Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';

const LIMIT = 50;
const ROLE_TABS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'teacher', label: '🧑‍🏫 Giáo viên' },
  { value: 'assistant', label: '🤝 Trợ giảng' },
];

const listOf = (r) => (Array.isArray(r) ? r : r?.items || []);
const nameOf = (u) => u.full_name || u.name || '—';

/* ----------------------------- Sheet hồ sơ ------------------------------ */
function StaffSheet({ user, canEdit, schools, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: user.full_name || '', phone: user.phone || '' });
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState(null);

  // Lớp phụ trách — quyết định người này thấy trường/lớp nào trong app.
  const [mine, setMine] = useState(null);          // [class_id] đang chọn
  const [pickSchool, setPickSchool] = useState('');
  const [classes, setClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/api/users/${user.id}/classes`)
      .then((r) => { if (live) setMine(listOf(r).map((c) => c.id)); })
      .catch(() => { if (live) setMine([]); });
    return () => { live = false; };
  }, [user.id]);

  useEffect(() => {
    if (!pickSchool) { setClasses([]); return undefined; }
    let live = true;
    setLoadingClasses(true);
    api.get('/api/classes', { school_id: pickSchool, limit: 200 })
      .then((r) => { if (live) setClasses(listOf(r)); })
      .catch(() => { if (live) setClasses([]); })
      .finally(() => { if (live) setLoadingClasses(false); });
    return () => { live = false; };
  }, [pickSchool]);

  const toggleClass = (id) => setMine((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  // Buổi dạy gần đây — cho thấy người này đang thực sự đứng lớp ở đâu.
  useEffect(() => {
    let live = true;
    api.get(`/api/users/${user.id}/schedule`, { limit: 8 })
      .then((r) => { if (live) setSessions(listOf(r)); })
      .catch(() => { if (live) setSessions([]); });
    return () => { live = false; };
  }, [user.id]);

  const save = async () => {
    if (!form.full_name.trim()) { toast.err('Họ và tên không được để trống.'); return; }
    setSaving(true);
    try {
      await api.patch(`/api/users/${user.id}`, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
      });
      if (mine) await api.put(`/api/users/${user.id}/classes`, { class_ids: mine });
      toast.ok('Đã lưu hồ sơ.');
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={saving ? undefined : onClose} title={nameOf(user)} wide>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <Badge tone={user.role === 'assistant' ? 'normal' : 'neutral'}>
          {LABEL.role[user.role] || user.role}
        </Badge>
        <Badge tone={user.is_active ? 'approved' : 'rejected'}>
          {user.is_active ? 'Đang hoạt động' : 'Đã khoá'}
        </Badge>
        {user.region_name && <Badge tone="low">{user.region_name}</Badge>}
      </div>

      {canEdit ? (
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Họ và tên" required>
            <input className="input" value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Số điện thoại">
            <input className="input" type="tel" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="VD: 0901234567" />
          </Field>
        </div>
      ) : (
        <div className="grid gap-1.5 text-sm mb-3">
          <div>📞 {user.phone || '— chưa có số điện thoại —'}</div>
        </div>
      )}

      <div className="grid gap-1.5 text-sm text-ink-soft mb-3">
        <div>✉️ {user.email}</div>
        {user.birth_date && <div>🎂 {fmtDate(user.birth_date)}</div>}
        <div>🕘 Đăng nhập lần cuối: {user.last_login_at ? fmtAgo(user.last_login_at) : 'chưa bao giờ'}</div>
        {(user.school_names || []).length > 0 && (
          <div>🏫 Phụ trách: {user.school_names.join(', ')}</div>
        )}
      </div>

      <div className="border-t border-line pt-3 mb-3">
        <div className="font-bold text-base mb-1">Lớp phụ trách</div>
        <p className="text-sm text-ink-muted mb-2">
          Quyết định người này thấy trường/lớp nào trong app — chưa gắn lớp thì họ
          không tự thêm được buổi dạy và không có buổi nào để chấm công.
        </p>

        {mine === null ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <>
            {mine.length === 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2 text-sm text-amber-900 mb-2">
                ⚠️ Chưa phụ trách lớp nào.
              </div>
            )}

            {canEdit && (
              <>
                <Field label="Chọn trường để xem lớp">
                  <select className="input" value={pickSchool} onChange={(e) => setPickSchool(e.target.value)}>
                    <option value="">— Chọn trường —</option>
                    {(schools || []).map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                  </select>
                </Field>
                {loadingClasses && <Spinner className="h-4 w-4" />}
                {pickSchool && !loadingClasses && classes.length === 0 && (
                  <div className="text-sm text-ink-muted mb-2">Trường này chưa có lớp nào đang dùng.</div>
                )}
                {classes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {classes.map((c) => {
                      const on = mine.includes(c.id);
                      return (
                        <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                          className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition
                            ${on ? 'bg-brand-grad text-white ring-transparent'
                                 : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
                          {on ? '✓ ' : ''}{c.name}{c.grade ? ` — Khối ${c.grade}` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="text-sm text-ink-muted">
              Đang phụ trách <b>{mine.length}</b> lớp.
              {canEdit ? ' Bấm "Lưu hồ sơ" để áp dụng.' : ''}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-line pt-3">
        <div className="font-bold text-base mb-2">Buổi dạy gần đây</div>
        {sessions === null && <Spinner className="h-4 w-4" />}
        {sessions?.length === 0 && (
          <div className="text-sm text-ink-muted">Chưa có buổi dạy nào được phân công.</div>
        )}
        {sessions?.length > 0 && (
          <div className="grid gap-1.5">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm rounded-xl border border-line px-2.5 py-1.5">
                <span className="font-semibold text-brand-800 shrink-0">
                  {s.period ? `Tiết ${s.period}` : String(s.start_time || '').slice(0, 5)}
                </span>
                <span className="text-ink-muted shrink-0">{fmtDate(s.session_date)}</span>
                <span className="truncate">{s.school_name} — lớp {s.class_name}</span>
                <Badge tone={s.session_role === 'assistant' ? 'normal' : 'neutral'} className="ml-auto shrink-0">
                  {LABEL.classRole?.[s.session_role] || (s.session_role === 'assistant' ? 'Trợ giảng' : 'Giáo viên')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="form-actions flex justify-end gap-2.5 mt-4">
        <button className="btn-line" onClick={onClose} disabled={saving}>Đóng</button>
        {canEdit && (
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu hồ sơ'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------- Màn hình ------------------------------- */
export default function StaffDirectory() {
  const auth = useAuth();
  const toast = useToast();
  const canEdit = auth.can('users.manage');

  const [role, setRole] = useState('all');
  const [q, setQ] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [page, setPage] = useState(1);

  const [schools, setSchools] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get('/api/schools', { limit: 200, is_active: true })
      .then((r) => setSchools(listOf(r)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const common = {
        q: q || undefined,
        school_id: schoolId || undefined,
        // Xem theo trường thì lấy cả người chưa gắn để còn phân công được.
        link: schoolId ? 'any' : undefined,
        is_active: onlyActive ? true : undefined,
        page,
        limit: LIMIT,
      };
      if (role === 'all') {
        // Không có bộ lọc "hai vai trò" ở API — gọi hai lần rồi trộn.
        const [t, a] = await Promise.all([
          api.get('/api/users', { ...common, role: 'teacher' }),
          api.get('/api/users', { ...common, role: 'assistant' }),
        ]);
        const items = [...listOf(t), ...listOf(a)]
          .sort((x, y) => String(nameOf(x)).localeCompare(String(nameOf(y)), 'vi'));
        setData({ items, total: (t?.total || 0) + (a?.total || 0) });
      } else {
        setData(await api.get('/api/users', { ...common, role }));
      }
    } catch (e) {
      setError(e);
    }
  }, [role, q, schoolId, onlyActive, page]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const counts = useMemo(() => ({
    teacher: items.filter((u) => u.role === 'teacher').length,
    assistant: items.filter((u) => u.role === 'assistant').length,
    noPhone: items.filter((u) => !u.phone).length,
  }), [items]);

  return (
    <div>
      <PageHeader
        title="Giáo viên & Trợ giảng"
        sub="Danh bạ nhân sự đứng lớp — cập nhật liên lạc, trường phụ trách, buổi dạy"
        actions={canEdit && (
          <Link to="/tai-khoan" className="btn-primary">+ Thêm người</Link>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented value={role} onChange={(v) => { setRole(v); setPage(1); }} options={ROLE_TABS} />
        <select className="input !w-auto !py-2" value={schoolId}
          onChange={(e) => { setSchoolId(e.target.value); setPage(1); }} aria-label="Lọc theo trường">
          <option value="">Mọi trường</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
          <input type="checkbox" className="accent-brand-600" checked={onlyActive}
            onChange={(e) => { setOnlyActive(e.target.checked); setPage(1); }} />
          Chỉ người đang hoạt động
        </label>
      </div>

      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }}
        placeholder="Tìm theo họ tên hoặc email…" className="mb-4" />

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && data === null && <PageLoading />}

      {!error && data !== null && (items.length === 0 ? (
        <EmptyState
          icon="🧑‍🏫"
          title={q || schoolId ? 'Không tìm thấy ai phù hợp' : 'Chưa có giáo viên hoặc trợ giảng'}
          hint={q || schoolId
            ? 'Thử bỏ bớt bộ lọc, hoặc bỏ tích "Chỉ người đang hoạt động".'
            : 'Tài khoản giáo viên/trợ giảng được cấp ở mục Tài khoản.'}
        />
      ) : (
        <>
          <div className="text-sm text-ink-muted mb-2">
            {fmtNumber(items.length)} người — 🧑‍🏫 {counts.teacher} giáo viên · 🤝 {counts.assistant} trợ giảng
            {counts.noPhone > 0 && (
              <span className="text-amber-700"> · ⚠️ {counts.noPhone} người chưa có số điện thoại</span>
            )}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className="th">Họ và tên</th>
                  <th className="th">Vai trò</th>
                  <th className="th hidden xl:table-cell">Điện thoại</th>
                  <th className="th">Email</th>
                  <th className="th">Trường phụ trách</th>
                  <th className="th hidden xl:table-cell">Đăng nhập cuối</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className={`hover:bg-brand-50/40 cursor-pointer${u.is_active ? '' : ' opacity-55'}`}
                    onClick={() => setOpen(u)}>
                    <td data-label="Họ và tên" className="td">
                      <span className="flex items-center gap-2">
                        <span className="h-8 w-8 shrink-0 rounded-full bg-brand-grad-soft text-white grid place-items-center text-xs font-bold">
                          {initials(nameOf(u))}
                        </span>
                        <span className="font-semibold text-brand-800">{nameOf(u)}</span>
                        {schoolId && u.at_school && (
                          <Badge tone="approved" className="!text-xs">ở trường này</Badge>
                        )}
                      </span>
                    </td>
                    <td data-label="Vai trò" className="td whitespace-nowrap">
                      <Badge tone={u.role === 'assistant' ? 'normal' : 'neutral'}>
                        {LABEL.role[u.role] || u.role}
                      </Badge>
                    </td>
                    <td data-label="Điện thoại" className="hidden xl:table-cell td whitespace-nowrap">
                      {u.phone || <span className="text-amber-700">— chưa có —</span>}
                    </td>
                    <td data-label="Email" className="td max-w-[220px] truncate text-ink-muted">{u.email}</td>
                    <td data-label="Trường phụ trách" className="td max-w-[240px] truncate">
                      {(u.school_names || []).length ? u.school_names.join(', ') : <span className="text-ink-muted">—</span>}
                    </td>
                    <td data-label="Đăng nhập cuối" className="hidden xl:table-cell td whitespace-nowrap text-ink-muted">
                      {u.last_login_at ? fmtAgo(u.last_login_at) : 'chưa bao giờ'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-xs text-ink-muted bg-canvas/60 border-t border-line">
              Bấm một dòng để xem hồ sơ và buổi dạy gần đây
              {canEdit ? ' · sửa được họ tên và số điện thoại ngay tại đó.' : '.'}
            </div>
          </div>

          {role !== 'all' && <Pager page={page} limit={LIMIT} total={data?.total} onPage={setPage} />}
        </>
      ))}

      {open && (
        <StaffSheet
          key={open.id}
          user={open}
          canEdit={canEdit}
          schools={schools}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); load(); toast.ok('Đã cập nhật danh bạ.'); }}
        />
      )}
    </div>
  );
}
