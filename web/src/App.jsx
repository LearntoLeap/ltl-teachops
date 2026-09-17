/**
 * App.jsx — Bộ định tuyến + cổng xác thực.
 * Chưa đăng nhập → /dang-nhap. must_change_password → chặn ở màn hình đổi mật khẩu.
 * Route được bảo vệ theo quyền: thiếu quyền → về trang chủ.
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { PageLoading } from './components/ui.jsx';

// Màn hình công khai
import Login from './features/auth/Login.jsx';
import ForgotPassword from './features/auth/ForgotPassword.jsx';
import ResetPassword from './features/auth/ResetPassword.jsx';
import ChangePassword from './features/auth/ChangePassword.jsx';
import PrivacyPolicy from './features/legal/PrivacyPolicy.jsx';

// Màn hình chính — lazy để chia nhỏ bundle cho mobile.
const Dashboard      = lazy(() => import('./features/dashboard/Dashboard.jsx'));
const ScheduleList   = lazy(() => import('./features/schedule/ScheduleList.jsx'));
const TimesheetHome  = lazy(() => import('./features/timesheet/TimesheetHome.jsx'));
const CheckInOut     = lazy(() => import('./features/timesheet/CheckInOut.jsx'));
const AttendanceHome = lazy(() => import('./features/attendance/AttendanceHome.jsx'));
const AttendanceMark = lazy(() => import('./features/attendance/AttendanceMark.jsx'));
const DevicesHome    = lazy(() => import('./features/devices/DevicesHome.jsx'));
const MaterialsHome  = lazy(() => import('./features/materials/MaterialsHome.jsx'));
const MaterialDetail = lazy(() => import('./features/materials/MaterialDetail.jsx'));
const SolutionsHome  = lazy(() => import('./features/solutions/SolutionsHome.jsx'));
const FeedbackHome   = lazy(() => import('./features/feedback/FeedbackHome.jsx'));
const FeedbackDetail = lazy(() => import('./features/feedback/FeedbackDetail.jsx'));
const Reports        = lazy(() => import('./features/reports/Reports.jsx'));
const OrgHome        = lazy(() => import('./features/admin/OrgHome.jsx'));
const SchoolDetail   = lazy(() => import('./features/admin/SchoolDetail.jsx'));
const UsersAdmin     = lazy(() => import('./features/admin/UsersAdmin.jsx'));
const StaffDirectory = lazy(() => import('./features/admin/StaffDirectory.jsx'));
const AuditLog       = lazy(() => import('./features/admin/AuditLog.jsx'));
const DriveStorage   = lazy(() => import('./features/admin/DriveStorage.jsx'));
const OutboxScreen   = lazy(() => import('./features/outbox/OutboxScreen.jsx'));
const MoreScreen     = lazy(() => import('./features/more/MoreScreen.jsx'));
const SearchScreen   = lazy(() => import('./features/search/SearchScreen.jsx'));

/** Chặn route theo quyền. */
function Guard({ perm, children }) {
  const auth = useAuth();
  if (perm && !auth.can(perm)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const auth = useAuth();
  const location = useLocation();

  // Trang công khai — mở được dù đã hay chưa đăng nhập (Google kiểm tra link này).
  if (location.pathname === '/chinh-sach-bao-mat') return <PrivacyPolicy />;

  if (auth.loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-canvas">
        <PageLoading label="Đang khởi động…" />
      </div>
    );
  }

  // Chưa đăng nhập — chỉ cho vào các trang công khai.
  if (!auth.user) {
    return (
      <Routes>
        <Route path="/dang-nhap" element={<Login />} />
        <Route path="/quen-mat-khau" element={<ForgotPassword />} />
        <Route path="/dat-lai-mat-khau" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/dang-nhap" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  // Bắt buộc đổi mật khẩu trước khi dùng bất kỳ chức năng nào.
  if (auth.needPasswordChange) {
    return (
      <Routes>
        <Route path="*" element={<ChangePassword forced />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/lich" element={<ScheduleList />} />
          <Route path="/cham-cong" element={<TimesheetHome />} />
          <Route path="/cham-cong/:schoolId" element={<CheckInOut />} />
          <Route path="/diem-danh" element={<AttendanceHome />} />
          <Route path="/diem-danh/:scheduleId" element={<AttendanceMark />} />
          <Route path="/thiet-bi" element={<DevicesHome />} />
          <Route path="/hoc-lieu" element={<MaterialsHome />} />
          <Route path="/hoc-lieu/:id" element={<MaterialDetail />} />
          <Route path="/giai-phap" element={<SolutionsHome />} />
          <Route path="/gop-y" element={<FeedbackHome />} />
          <Route path="/gop-y/:id" element={<FeedbackDetail />} />
          <Route path="/bao-cao" element={<Guard perm="report.view"><Reports /></Guard>} />
          <Route path="/nhan-su" element={<Guard perm="users.view"><StaffDirectory /></Guard>} />
          <Route path="/to-chuc" element={<Guard perm="org.manage"><OrgHome /></Guard>} />
          <Route path="/to-chuc/:schoolId" element={<Guard perm="org.manage"><SchoolDetail /></Guard>} />
          <Route path="/tai-khoan" element={<Guard perm="users.manage"><UsersAdmin /></Guard>} />
          <Route path="/nhat-ky" element={<Guard perm="audit.view"><AuditLog /></Guard>} />
          <Route path="/luu-tru-drive" element={<Guard perm="drive.manage"><DriveStorage /></Guard>} />
          <Route path="/cho-dong-bo" element={<OutboxScreen />} />
          <Route path="/doi-mat-khau" element={<ChangePassword />} />
          <Route path="/tim-kiem" element={<SearchScreen />} />
          <Route path="/khac" element={<MoreScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
