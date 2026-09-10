/**
 * rbac.js — NGUỒN SỰ THẬT DUY NHẤT về quyền hạn.
 *
 * Đổi quyền của một vai trò ⇒ chỉ sửa bảng PERMISSIONS dưới đây.
 * Frontend nhận danh sách quyền qua GET /api/auth/me để ẩn/hiện nút,
 * nhưng quyết định cuối cùng LUÔN nằm ở server (requirePerm).
 *
 * Đối chiếu ma trận quyền tại docs/API.md.
 */
import { forbidden } from './errors.js';

export const ROLES = /** @type {const} */ (['admin', 'manager', 'teacher', 'assistant']);

export const ROLE_LABEL = {
  admin: 'Quản trị viên',
  manager: 'Phòng chuyên môn',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
};

/** Quyền → danh sách vai trò được phép. */
const PERMISSIONS = {
  // Tài khoản
  'users.manage':            ['admin'],
  'users.view':              ['admin', 'manager'],

  // Tổ chức: trường / lớp / phòng STEM
  'org.manage':              ['admin', 'manager'],
  'org.view':                ['admin', 'manager', 'teacher', 'assistant'],

  // Lịch dạy
  'schedule.manage':         ['admin', 'manager'],
  'schedule.viewOwn':        ['admin', 'manager', 'teacher', 'assistant'],

  // Chấm công
  'timesheet.self':          ['admin', 'manager', 'teacher', 'assistant'],
  'timesheet.viewAll':       ['admin', 'manager'],
  'timesheet.edit':          ['admin'],
  'timesheet.approve':       ['admin', 'manager'],

  // Điểm danh học sinh
  'attendance.submit':       ['admin', 'manager', 'teacher', 'assistant'],
  'attendance.viewAll':      ['admin', 'manager'],

  // Thiết bị phòng STEM
  'device.check':            ['admin', 'manager', 'teacher', 'assistant'],
  'device.catalog':          ['admin', 'manager'],
  'device.reportIssue':      ['admin', 'manager', 'teacher', 'assistant'],
  'device.resolveIssue':     ['admin', 'manager'],

  // Học liệu
  'material.official.write': ['admin', 'manager'],
  'material.teacher.write':  ['admin', 'manager', 'teacher', 'assistant'],
  'material.approve':        ['admin', 'manager'],
  'material.view':           ['admin', 'manager', 'teacher', 'assistant'],

  // Danh mục giải pháp
  'solution.manageRoot':     ['admin'],
  'solution.manageChild':    ['admin', 'manager'],
  'solution.view':           ['admin', 'manager', 'teacher', 'assistant'],

  // Góp ý
  'feedback.create':         ['admin', 'manager', 'teacher', 'assistant'],
  'feedback.resolve':        ['admin', 'manager'],

  // Báo cáo & xuất dữ liệu
  'report.view':             ['admin', 'manager'],
  'export.all':              ['admin'],
  'export.scope':            ['admin', 'manager'],
  'export.self':             ['admin', 'manager', 'teacher', 'assistant'],

  // Nhật ký thao tác
  'audit.view':              ['admin'],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/** Người dùng có quyền này không? */
export function can(user, perm) {
  if (!user || !user.role) return false;
  const allowed = PERMISSIONS[perm];
  if (!allowed) throw new Error(`[rbac] Quyền không tồn tại: ${perm}`);
  return allowed.includes(user.role);
}

/** Danh sách quyền của một vai trò — gửi cho frontend. */
export function permissionsFor(role) {
  return ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].includes(role));
}

/** Ném lỗi 403 nếu thiếu quyền. Dùng trong thân handler. */
export function assertPerm(user, perm) {
  if (!can(user, perm)) {
    throw forbidden(`Vai trò "${ROLE_LABEL[user?.role] || 'không xác định'}" không được phép thực hiện thao tác này.`);
  }
}

/** preHandler của Fastify: fastify.get('/x', { preHandler: requirePerm('org.manage') }, fn) */
export function requirePerm(perm) {
  return async function (req) {
    assertPerm(req.user, perm);
  };
}

/** preHandler: chỉ cho phép một số vai trò cụ thể. */
export function requireRole(...roles) {
  return async function (req) {
    if (!req.user || !roles.includes(req.user.role)) {
      throw forbidden('Bạn không có quyền truy cập chức năng này.');
    }
  };
}

export const isAdmin = (u) => u?.role === 'admin';
export const isManager = (u) => u?.role === 'manager';
/** Giáo viên hoặc trợ giảng — nhóm "người dạy ở hiện trường". */
export const isFieldStaff = (u) => u?.role === 'teacher' || u?.role === 'assistant';
