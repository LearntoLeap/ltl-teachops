/**
 * MoreScreen.jsx — Menu "Thêm" (/khac) của bottom nav mobile.
 *
 * Gom các mục không nằm trong bottom nav, lọc theo quyền giống sidebar AppLayout.
 * Cuối trang: thẻ thông tin tài khoản + đăng xuất + phiên bản ứng dụng.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { initials } from '../../lib/format.js';
import { PageHeader, ConfirmSheet } from '../../components/ui.jsx';

/** Một hàng liên kết: icon + tên + chevron. */
function MenuRow({ to, icon, label }) {
  return (
    <Link to={to} className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-canvas active:bg-canvas transition">
      <span className="text-xl w-7 text-center leading-none">{icon}</span>
      <span className="flex-1 text-base font-medium text-ink">{label}</span>
      <span className="text-ink-muted text-xl leading-none">›</span>
    </Link>
  );
}

/** Danh sách mục theo vai trò — chỉ những mục KHÔNG có trong bottom nav. */
function menuItems(auth) {
  const items = [];
  // Field staff có sẵn Chấm công/Điểm danh/Học liệu ở bottom nav; manager/admin có sẵn Lịch dạy/Báo cáo.
  if (auth.isFieldStaff) items.push({ to: '/lich', icon: '🗓️', label: 'Lịch dạy' });
  if (!auth.isFieldStaff) items.push({ to: '/diem-danh', icon: '📋', label: 'Điểm danh' });
  items.push({ to: '/thiet-bi', icon: '🛠️', label: 'Thiết bị' });
  if (!auth.isFieldStaff) items.push({ to: '/hoc-lieu', icon: '📚', label: 'Học liệu' });
  items.push({ to: '/giai-phap', icon: '🧩', label: 'Giải pháp' });
  items.push({ to: '/gop-y', icon: '📨', label: 'Góp ý' });
  if (auth.can('report.view')) items.push({ to: '/bao-cao', icon: '📊', label: 'Báo cáo' });
  if (auth.can('org.manage')) items.push({ to: '/to-chuc', icon: '🏫', label: 'Trường & Lớp' });
  if (auth.can('users.view')) items.push({ to: '/nhan-su', icon: '🧑‍🏫', label: 'Giáo viên & Trợ giảng' });
  if (auth.can('users.manage')) items.push({ to: '/tai-khoan', icon: '👥', label: 'Tài khoản' });
  if (auth.can('audit.view')) items.push({ to: '/nhat-ky', icon: '🧾', label: 'Nhật ký' });
  if (auth.can('drive.manage')) items.push({ to: '/luu-tru-drive', icon: '☁️', label: 'Lưu trữ Drive' });
  items.push({ to: '/cho-dong-bo', icon: '⏳', label: 'Chờ đồng bộ' });
  items.push({ to: '/doi-mat-khau', icon: '🔑', label: 'Đổi mật khẩu' });
  return items;
}

export default function MoreScreen() {
  const auth = useAuth();
  const [askSignOut, setAskSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const doSignOut = async () => {
    setSigningOut(true);
    // signOut luôn đăng xuất cục bộ kể cả khi server lỗi; App sẽ tự chuyển về /dang-nhap.
    await auth.signOut();
  };

  return (
    <div>
      <PageHeader title="Thêm" sub="Các chức năng khác của ứng dụng" />

      {/* Danh sách liên kết */}
      <div className="card overflow-hidden divide-y divide-line">
        {menuItems(auth).map((it) => (
          <MenuRow key={it.to} to={it.to} icon={it.icon} label={it.label} />
        ))}
      </div>

      {/* Thẻ tài khoản */}
      <div className="card p-4 mt-5">
        <div className="flex items-center gap-3">
          <span className="h-12 w-12 shrink-0 rounded-full bg-brand-grad-soft text-white grid place-items-center font-bold text-lg">
            {initials(auth.user?.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate">{auth.user?.full_name}</div>
            <div className="text-sm text-ink-muted truncate">{auth.user?.email}</div>
            <div className="text-xs text-brand-700 font-semibold">{auth.roleLabel}</div>
          </div>
        </div>
        <button className="btn-danger w-full mt-4" onClick={() => setAskSignOut(true)}>
          🚪 Đăng xuất
        </button>
      </div>

      <div className="text-center text-xs text-ink-muted mt-5">LtL TeachOps v1.0</div>

      {/* Xác nhận đăng xuất */}
      <ConfirmSheet
        open={askSignOut}
        onClose={() => setAskSignOut(false)}
        onConfirm={doSignOut}
        danger
        busy={signingOut}
        title="Đăng xuất"
        confirmLabel="Đăng xuất"
        message="Bạn có chắc muốn đăng xuất khỏi LtL TeachOps trên thiết bị này? Dữ liệu chờ đồng bộ (nếu có) vẫn được giữ lại và sẽ gửi sau khi bạn đăng nhập lại."
      />
    </div>
  );
}
