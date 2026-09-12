/**
 * AppLayout.jsx — Khung ứng dụng sau đăng nhập, phong cách "bảng điều độ":
 * sidebar tối màu như đài điều hành, vùng nội dung sáng.
 *
 * Desktop: rail trái nền tím than, nav chia nhóm VẬN HÀNH / NỘI DUNG / QUẢN TRỊ
 * theo quyền; khối danh tính (avatar + vai trò) bấm mở menu tài khoản.
 * Mobile: topbar gradient + bottom nav 5 mục dạng viên thuốc.
 * Kèm: chuông thông báo, chấm trạng thái mạng, badge hàng đợi đồng bộ.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { onOutboxChange, pendingCount, startSync } from '../lib/offline.js';
import { initials, fmtDateLong, today } from '../lib/format.js';
import NotificationBell from '../components/NotificationBell.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { Sheet } from '../components/ui.jsx';

/** Màu chip vai trò trên nền tối. */
const ROLE_CHIP = {
  admin: 'bg-amber-400/20 text-amber-300',
  manager: 'bg-sky-400/20 text-sky-300',
  teacher: 'bg-emerald-400/20 text-emerald-300',
  assistant: 'bg-emerald-400/20 text-emerald-300',
};

/** Nav chia nhóm — nhóm rỗng (do lọc quyền) sẽ bị ẩn. */
function navGroups(auth) {
  const groups = [
    {
      label: 'Vận hành',
      items: [
        { to: '/', icon: '🏠', label: 'Trang chủ', end: true },
        { to: '/lich', icon: '🗓️', label: 'Lịch dạy' },
        { to: '/cham-cong', icon: '📍', label: 'Chấm công' },
        { to: '/diem-danh', icon: '📋', label: 'Điểm danh' },
        { to: '/thiet-bi', icon: '🛠️', label: 'Thiết bị' },
      ],
    },
    {
      label: 'Nội dung',
      items: [
        { to: '/hoc-lieu', icon: '📚', label: 'Học liệu' },
        { to: '/giai-phap', icon: '🧩', label: 'Giải pháp' },
        { to: '/gop-y', icon: '📨', label: 'Góp ý' },
      ],
    },
    {
      label: 'Quản trị',
      items: [
        auth.can('report.view') && { to: '/bao-cao', icon: '📊', label: 'Báo cáo' },
        auth.can('org.manage') && { to: '/to-chuc', icon: '🏫', label: 'Trường & Lớp' },
        auth.can('users.manage') && { to: '/tai-khoan', icon: '👥', label: 'Tài khoản' },
        auth.can('audit.view') && { to: '/nhat-ky', icon: '🧾', label: 'Nhật ký' },
        auth.can('drive.manage') && { to: '/luu-tru-drive', icon: '☁️', label: 'Lưu trữ Drive' },
      ].filter(Boolean),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** 5 mục quan trọng nhất cho bottom nav mobile, tuỳ vai trò. */
function bottomItems(auth) {
  if (auth.isFieldStaff) {
    return [
      { to: '/', icon: '🏠', label: 'Trang chủ', end: true },
      { to: '/cham-cong', icon: '📍', label: 'Chấm công' },
      { to: '/diem-danh', icon: '📋', label: 'Điểm danh' },
      { to: '/hoc-lieu', icon: '📚', label: 'Học liệu' },
      { to: '/khac', icon: '☰', label: 'Thêm' },
    ];
  }
  return [
    { to: '/', icon: '🏠', label: 'Trang chủ', end: true },
    { to: '/lich', icon: '🗓️', label: 'Lịch dạy' },
    { to: '/cham-cong', icon: '📍', label: 'Chấm công' },
    { to: '/bao-cao', icon: '📊', label: 'Báo cáo' },
    { to: '/khac', icon: '☰', label: 'Thêm' },
  ];
}

export default function AppLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);

  // Đồng bộ offline + theo dõi trạng thái mạng.
  useEffect(() => {
    startSync();
    pendingCount().then(setQueued);
    const off = onOutboxChange((items) => setQueued(items.length));
    const on = () => setOnline(true);
    const offline = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', offline);
    return () => { off(); window.removeEventListener('online', on); window.removeEventListener('offline', offline); };
  }, []);

  const groups = navGroups(auth);

  return (
    <div className="min-h-dvh flex">
      {/* ---------------- Rail điều độ (desktop) ---------------- */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-dvh
                        bg-gradient-to-b from-night to-night-deep text-white">
        {/* Thương hiệu */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span className="h-10 w-10 rounded-xl bg-brand-grad grid place-items-center text-[20px] shadow-card-sm">
            🤖
          </span>
          <span>
            <span className="block font-extrabold text-[16.5px] leading-tight">LtL TeachOps</span>
            <span className="block text-[11px] text-white/50">Learn to Leap · Vận hành giảng dạy</span>
          </span>
        </div>

        {/* Danh tính người trực */}
        <button
          onClick={() => setAccountOpen(true)}
          className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-white/[.06] hover:bg-white/[.1]
                     border border-white/10 px-3.5 py-3 text-left transition">
          <span className="h-10 w-10 rounded-full bg-brand-grad-soft grid place-items-center font-bold shrink-0">
            {initials(auth.user?.full_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold truncate">{auth.user?.full_name}</span>
            <span className={`inline-block mt-0.5 rounded-full px-2 py-[1px] text-[10.5px] font-bold ${ROLE_CHIP[auth.role] || 'bg-white/10 text-white/70'}`}>
              {auth.roleLabel}
            </span>
          </span>
          <span className="text-white/35 text-[13px]">⚙️</span>
        </button>

        {/* Điều hướng chia nhóm */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
          {groups.map((g) => (
            <div key={g.label} className="mt-3 first:mt-1">
              <div className="px-2.5 mb-1 text-[10px] font-bold uppercase tracking-[.14em] text-white/35">
                {g.label}
              </div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 px-3 py-[9px] rounded-xl mb-0.5 text-[13.5px] transition
                     ${isActive
                       ? 'bg-white/10 text-white font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-brand-grad'
                       : 'text-white/65 hover:bg-white/[.05] hover:text-white'}`}>
                  <span className="text-[16px] w-6 text-center">{it.icon}</span>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Trạng thái đường truyền / hàng đợi */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center gap-2.5 text-[12px]">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="text-white/55 flex-1">{online ? 'Trực tuyến' : 'Mất mạng — dữ liệu lưu tạm'}</span>
          {queued > 0 && (
            <button onClick={() => navigate('/cho-dong-bo')}
              className="rounded-full bg-amber-400/90 text-amber-950 px-2 py-0.5 font-bold text-[11px]">
              ⏳ {queued}
            </button>
          )}
        </div>
      </aside>

      {/* ---------------- Cột nội dung ---------------- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar mobile — gradient thương hiệu */}
        <header className="lg:hidden sticky top-0 z-40 bg-brand-grad text-white rounded-b-[22px] shadow-card"
          style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[16px] leading-tight truncate">LtL TeachOps</div>
              <div className="text-[11px] opacity-85 truncate">{auth.user?.full_name} · {auth.roleLabel}</div>
            </div>
            {!online && (
              <span className="text-[11px] bg-white/20 rounded-full px-2.5 py-1 font-semibold">⚡ Offline</span>
            )}
            {queued > 0 && (
              <button onClick={() => navigate('/cho-dong-bo')}
                className="text-[11px] bg-amber-400/90 text-amber-950 rounded-full px-2.5 py-1 font-bold">
                ⏳ {queued}
              </button>
            )}
            <button onClick={() => navigate('/tim-kiem')}
              className="h-9 w-9 rounded-full bg-white/20 grid place-items-center text-[16px]"
              aria-label="Tìm kiếm">
              🔍
            </button>
            <NotificationBell />
            <button onClick={() => setAccountOpen(true)}
              className="h-9 w-9 rounded-full bg-white/20 grid place-items-center font-bold"
              aria-label="Tài khoản">
              {initials(auth.user?.full_name)}
            </button>
          </div>
        </header>

        {/* Topbar desktop — ngày + trạng thái + chuông */}
        <header className="hidden lg:flex sticky top-0 z-40 items-center gap-3 bg-canvas/85 backdrop-blur
                           px-6 py-2.5 border-b border-line">
          <span className="text-[13px] font-semibold text-ink-soft whitespace-nowrap">{fmtDateLong(today())}</span>
          <span className="flex-1" />
          <GlobalSearch />
          {!online && <span className="text-[12px] bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-semibold">⚡ Đang offline</span>}
          {queued > 0 && (
            <button onClick={() => navigate('/cho-dong-bo')}
              className="text-[12px] bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-bold hover:bg-amber-200">
              ⏳ {queued} mục chờ đồng bộ
            </button>
          )}
          <div className="[&>button]:!bg-brand-100 [&>button]:!text-brand-800">
            <NotificationBell />
          </div>
        </header>

        {/* Nội dung trang */}
        <main className="flex-1 px-4 lg:px-6 py-4 lg:py-5 max-w-6xl w-full mx-auto"
          style={{ paddingBottom: 'calc(84px + var(--safe-bot))' }}>
          <Outlet />
        </main>
      </div>

      {/* ---------------- Bottom nav mobile — viên thuốc ---------------- */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line flex px-1"
        style={{ paddingBottom: 'var(--safe-bot)' }}>
        {bottomItems(auth).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-semibold transition
               ${isActive ? 'text-brand-800' : 'text-ink-muted'}`}>
            {({ isActive }) => (
              <>
                <span className={`text-[19px] leading-none rounded-full px-4 py-1 transition
                                  ${isActive ? 'bg-brand-100' : ''}`}>
                  {it.icon}
                </span>
                {it.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ---------------- Menu tài khoản ---------------- */}
      <Sheet open={accountOpen} onClose={() => setAccountOpen(false)} title="Tài khoản">
        <div className="flex items-center gap-3 mb-4">
          <span className="h-12 w-12 rounded-full bg-brand-grad-soft text-white grid place-items-center font-bold text-lg">
            {initials(auth.user?.full_name)}
          </span>
          <div>
            <div className="font-bold">{auth.user?.full_name}</div>
            <div className="text-[13px] text-ink-muted">{auth.user?.email}</div>
            <div className="text-[12px] text-brand-700 font-semibold">
              {auth.roleLabel}
              {auth.user?.region_name ? ` · 📍 ${auth.user.region_name}` : ''}
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <button className="btn-line justify-start" onClick={() => { setAccountOpen(false); navigate('/doi-mat-khau'); }}>
            🔑 Đổi mật khẩu
          </button>
          <button className="btn-line justify-start" onClick={() => { setAccountOpen(false); navigate('/cho-dong-bo'); }}>
            ⏳ Dữ liệu chờ đồng bộ {queued > 0 ? `(${queued})` : ''}
          </button>
          <button className="btn-danger justify-start" onClick={() => auth.signOut()}>
            🚪 Đăng xuất
          </button>
        </div>
      </Sheet>
    </div>
  );
}
