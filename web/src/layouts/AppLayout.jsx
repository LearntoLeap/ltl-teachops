/**
 * AppLayout.jsx — Khung ứng dụng sau đăng nhập, phong cách "bảng điều độ":
 * sidebar tối màu như đài điều hành, vùng nội dung sáng.
 *
 * Desktop (≥1280px): rail trái nền tím than, nav chia nhóm VẬN HÀNH / NỘI DUNG /
 * QUẢN TRỊ theo quyền; khối danh tính (avatar + vai trò) bấm mở menu tài khoản.
 * Tablet (768–1279px): rail thu gọn còn biểu tượng, nhãn hiện khi rê chuột.
 * Mobile (<768px): topbar gradient + bottom nav 5 mục dạng viên thuốc.
 * Kèm: chuông thông báo, chấm trạng thái mạng, badge hàng đợi đồng bộ.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { onOutboxChange, pendingCount, startSync } from '../lib/offline.js';
import { initials, fmtDateLong, today } from '../lib/format.js';
import NotificationBell from '../components/NotificationBell.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { Sheet } from '../components/ui.jsx';

/**
 * Tên hiển thị của từng nhánh route — dùng cho breadcrumb trên header.
 * Chỉ phục vụ hiển thị; không ảnh hưởng điều hướng hay quyền.
 */
const ROUTE_LABEL = {
  '/lich': 'Lịch dạy',
  '/cham-cong': 'Chấm công',
  '/diem-danh': 'Điểm danh',
  '/thiet-bi': 'Thiết bị',
  '/hoc-lieu': 'Học liệu',
  '/giai-phap': 'Giải pháp',
  '/gop-y': 'Góp ý',
  '/bao-cao': 'Báo cáo',
  '/nhan-su': 'Giáo viên & Trợ giảng',
  '/to-chuc': 'Trường & Lớp',
  '/tai-khoan': 'Tài khoản',
  '/nhat-ky': 'Nhật ký',
  '/luu-tru-drive': 'Lưu trữ Drive',
  '/cho-dong-bo': 'Chờ đồng bộ',
  '/doi-mat-khau': 'Đổi mật khẩu',
  '/tim-kiem': 'Tìm kiếm',
  '/khac': 'Thêm',
};

/** Đường dẫn phân cấp: Trang chủ › Mục › (Chi tiết). */
function Breadcrumb() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  const branch = parts.length ? `/${parts[0]}` : '/';
  const label = ROUTE_LABEL[branch];
  const crumb = 'text-ink-muted hover:text-brand-700 transition-colors duration-fast';

  return (
    <nav aria-label="Đường dẫn" className="flex items-center gap-1.5 text-sm min-w-0">
      {parts.length === 0 ? (
        <span className="font-semibold text-ink">Trang chủ</span>
      ) : (
        <>
          <Link to="/" className={crumb}>Trang chủ</Link>
          <span className="text-ink-muted/50" aria-hidden>›</span>
          {parts.length > 1 && label ? (
            <>
              <Link to={branch} className={`${crumb} truncate`}>{label}</Link>
              <span className="text-ink-muted/50" aria-hidden>›</span>
              <span className="font-semibold text-ink truncate">Chi tiết</span>
            </>
          ) : (
            <span className="font-semibold text-ink truncate">{label || 'Trang'}</span>
          )}
        </>
      )}
    </nav>
  );
}

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
        auth.can('users.view') && { to: '/nhan-su', icon: '🧑‍🏫', label: 'Giáo viên & Trợ giảng' },
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
      <aside className="hidden md:flex flex-col w-[76px] xl:w-64 shrink-0 sticky top-0 h-dvh
                        bg-gradient-to-b from-night to-night-deep text-white
                        transition-[width] duration-base ease-out">
        {/* Thương hiệu */}
        <div className="flex items-center justify-center xl:justify-start gap-3 px-3 xl:px-5 pt-5 pb-4">
          <span className="h-10 w-10 rounded-xl2 bg-brand-grad grid place-items-center text-xl shadow-card-sm shrink-0">
            🤖
          </span>
          <span className="hidden xl:block min-w-0">
            <span className="block font-extrabold text-lg leading-tight">LtL TeachOps</span>
            <span className="block text-xs text-white/50 truncate">Learn to Leap · Vận hành giảng dạy</span>
          </span>
        </div>

        {/* Danh tính người trực */}
        <button
          onClick={() => setAccountOpen(true)}
          title="Tài khoản"
          className="mx-3 mb-2 flex items-center justify-center xl:justify-start gap-3 rounded-xl3 bg-white/[.06]
                     hover:bg-white/[.1] border border-white/10 px-2 xl:px-3.5 py-3 text-left
                     transition-colors duration-fast ease-out">
          <span className="h-10 w-10 rounded-full bg-brand-grad-soft grid place-items-center font-bold shrink-0">
            {initials(auth.user?.full_name)}
          </span>
          <span className="hidden xl:block min-w-0 flex-1">
            <span className="block text-sm font-semibold truncate">{auth.user?.full_name}</span>
            <span className={`inline-block mt-0.5 rounded-full px-2 py-[1px] text-xs font-bold ${ROLE_CHIP[auth.role] || 'bg-white/10 text-white/70'}`}>
              {auth.roleLabel}
            </span>
          </span>
          <span className="hidden xl:block text-white/35 text-sm">⚙️</span>
        </button>

        {/* Điều hướng chia nhóm */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
          {groups.map((g) => (
            <div key={g.label} className="mt-3 first:mt-1">
              <div className="hidden xl:block px-2.5 mb-1 text-xs font-bold uppercase tracking-[.14em] text-white/35">
                {g.label}
              </div>
              <div className="xl:hidden mx-auto mb-1.5 h-px w-8 bg-white/10" aria-hidden />
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} title={it.label}
                  className={({ isActive }) =>
                    `relative flex items-center justify-center xl:justify-start gap-3 px-3 py-2.5 rounded-xl2 mb-0.5
                     text-sm transition-all duration-fast ease-out
                     ${isActive
                       ? 'bg-white/10 text-white font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-brand-grad'
                       : 'text-white/65 hover:bg-white/[.05] hover:text-white'}`}>
                  <span className="text-xl w-6 text-center shrink-0">{it.icon}</span>
                  <span className="hidden xl:inline truncate">{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Trạng thái đường truyền / hàng đợi */}
        <div className="px-3 xl:px-5 py-3.5 border-t border-white/10 flex items-center justify-center xl:justify-start gap-2.5 text-xs"
          title={online ? 'Trực tuyến' : 'Mất mạng — dữ liệu lưu tạm'}>
          <span className={`h-2 w-2 rounded-full shrink-0 ${online ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="hidden xl:block text-white/55 flex-1">{online ? 'Trực tuyến' : 'Mất mạng — dữ liệu lưu tạm'}</span>
          {queued > 0 && (
            <button onClick={() => navigate('/cho-dong-bo')}
              className="rounded-full bg-amber-400/90 text-amber-950 px-2 py-0.5 font-bold text-xs">
              ⏳ {queued}
            </button>
          )}
        </div>
      </aside>

      {/* ---------------- Cột nội dung ---------------- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar mobile — gradient thương hiệu */}
        <header className="md:hidden sticky top-0 z-40 bg-brand-grad text-white rounded-b-xl3 shadow-card"
          style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-lg leading-tight truncate">LtL TeachOps</div>
              <div className="text-xs opacity-85 truncate">{auth.user?.full_name} · {auth.roleLabel}</div>
            </div>
            {!online && (
              <span className="text-xs bg-white/20 rounded-full px-2.5 py-1 font-semibold">⚡ Offline</span>
            )}
            {queued > 0 && (
              <button onClick={() => navigate('/cho-dong-bo')}
                className="text-xs bg-amber-400/90 text-amber-950 rounded-full px-2.5 py-1 font-bold">
                ⏳ {queued}
              </button>
            )}
            <button onClick={() => navigate('/tim-kiem')}
              className="icon-btn rounded-full bg-white/20 hover:bg-white/30 text-lg"
              aria-label="Tìm kiếm">
              🔍
            </button>
            <NotificationBell />
            <button onClick={() => setAccountOpen(true)}
              className="icon-btn rounded-full bg-white/20 hover:bg-white/30 font-bold"
              aria-label="Tài khoản">
              {initials(auth.user?.full_name)}
            </button>
          </div>
        </header>

        {/* Topbar desktop — ngày + trạng thái + chuông */}
        <header className="hidden md:flex sticky top-0 z-40 items-center gap-3 bg-canvas/85 backdrop-blur
                           px-4 lg:px-6 py-2.5 border-b border-line">
          <Breadcrumb />
          <span className="h-4 w-px bg-line shrink-0" aria-hidden />
          <span className="text-sm font-semibold text-ink-soft whitespace-nowrap hidden lg:block">{fmtDateLong(today())}</span>
          <span className="flex-1" />
          <GlobalSearch />
          {!online && <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-semibold">⚡ Đang offline</span>}
          {queued > 0 && (
            <button onClick={() => navigate('/cho-dong-bo')}
              className="text-xs bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-bold hover:bg-amber-200">
              ⏳ {queued} mục chờ đồng bộ
            </button>
          )}
          <div className="[&>button]:!bg-brand-100 [&>button]:!text-brand-800">
            <NotificationBell />
          </div>
        </header>

        {/* Nội dung trang */}
        <main className="page-enter flex-1 px-4 lg:px-6 py-4 lg:py-5 max-w-[1440px] w-full mx-auto
                         pb-[calc(84px+var(--safe-bot))] md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* ---------------- Bottom nav mobile — viên thuốc ---------------- */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line flex px-1"
        style={{ paddingBottom: 'var(--safe-bot)' }}>
        {bottomItems(auth).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) =>
              `flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-semibold
               transition-colors duration-fast ease-out
               ${isActive ? 'text-brand-800' : 'text-ink-muted'}`}>
            {({ isActive }) => (
              <>
                <span className={`text-xl leading-none rounded-full px-4 py-1 transition-all duration-fast ease-out
                                  ${isActive ? 'bg-brand-100 scale-105' : ''}`}>
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
            <div className="text-sm text-ink-muted">{auth.user?.email}</div>
            <div className="text-xs text-brand-700 font-semibold">
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
