/**
 * AppLayout.jsx — Khung ứng dụng sau đăng nhập.
 * Desktop: sidebar trái theo vai trò. Mobile: topbar gradient + bottom nav 5 mục.
 * Kèm: chuông thông báo, badge offline/hàng đợi đồng bộ, menu tài khoản.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { onOutboxChange, pendingCount, startSync } from '../lib/offline.js';
import { initials } from '../lib/format.js';
import NotificationBell from '../components/NotificationBell.jsx';
import { Sheet } from '../components/ui.jsx';

/** Danh sách mục điều hướng — lọc theo quyền. */
function navItems(auth) {
  const items = [
    { to: '/', icon: '🏠', label: 'Trang chủ', end: true },
    { to: '/lich', icon: '🗓️', label: 'Lịch dạy' },
    { to: '/cham-cong', icon: '📍', label: 'Chấm công' },
    { to: '/diem-danh', icon: '📋', label: 'Điểm danh' },
    { to: '/thiet-bi', icon: '🛠️', label: 'Thiết bị' },
    { to: '/hoc-lieu', icon: '📚', label: 'Học liệu' },
    { to: '/giai-phap', icon: '🧩', label: 'Giải pháp' },
    { to: '/gop-y', icon: '📨', label: 'Góp ý' },
  ];
  if (auth.can('report.view')) items.push({ to: '/bao-cao', icon: '📊', label: 'Báo cáo' });
  if (auth.can('org.manage')) items.push({ to: '/to-chuc', icon: '🏫', label: 'Trường & Lớp' });
  if (auth.can('users.manage')) items.push({ to: '/tai-khoan', icon: '👥', label: 'Tài khoản' });
  if (auth.can('audit.view')) items.push({ to: '/nhat-ky', icon: '🧾', label: 'Nhật ký' });
  return items;
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

  const items = navItems(auth);

  return (
    <div className="min-h-dvh flex">
      {/* ---------------- Sidebar desktop ---------------- */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-white border-r border-line sticky top-0 h-dvh">
        <div className="bg-brand-grad text-white px-5 py-5">
          <div className="font-extrabold text-[17px] leading-tight">LtL TeachOps</div>
          <div className="text-[11.5px] opacity-85 mt-0.5">Learn to Leap · Vận hành giảng dạy</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-[14px] font-medium transition
                 ${isActive ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-ink-soft hover:bg-canvas'}`}>
              <span className="text-[17px] w-6 text-center">{it.icon}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => setAccountOpen(true)}
          className="flex items-center gap-3 px-4 py-3.5 border-t border-line hover:bg-canvas transition text-left">
          <span className="h-9 w-9 rounded-full bg-brand-grad-soft text-white grid place-items-center font-bold">
            {initials(auth.user?.full_name)}
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold truncate">{auth.user?.full_name}</span>
            <span className="block text-[11.5px] text-ink-muted">{auth.roleLabel}</span>
          </span>
        </button>
      </aside>

      {/* ---------------- Cột nội dung ---------------- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar (mobile hiển thị đầy đủ; desktop chỉ thanh mỏng phải) */}
        <header className="lg:hidden sticky top-0 z-40 bg-brand-grad text-white rounded-b-[22px] shadow-card"
          style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[16px] leading-tight truncate">LtL TeachOps</div>
              <div className="text-[11px] opacity-85">{auth.user?.full_name} · {auth.roleLabel}</div>
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
            <NotificationBell />
            <button onClick={() => setAccountOpen(true)}
              className="h-9 w-9 rounded-full bg-white/20 grid place-items-center font-bold"
              aria-label="Tài khoản">
              {initials(auth.user?.full_name)}
            </button>
          </div>
        </header>

        <header className="hidden lg:flex sticky top-0 z-40 items-center justify-end gap-3 bg-canvas/85 backdrop-blur px-6 py-3 border-b border-line">
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

      {/* ---------------- Bottom nav mobile ---------------- */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line flex"
        style={{ paddingBottom: 'var(--safe-bot)' }}>
        {bottomItems(auth).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition
               ${isActive ? 'text-brand-700' : 'text-ink-muted'}`}>
            <span className="text-[20px] leading-none">{it.icon}</span>
            {it.label}
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
            <div className="text-[12px] text-brand-700 font-semibold">{auth.roleLabel}</div>
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
