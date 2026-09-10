/**
 * errors.js — Lỗi nghiệp vụ có mã HTTP và thông báo tiếng Việt hiển thị thẳng cho người dùng.
 * Mọi route ném AppError; handler ở app.js chuyển thành { error: { code, message, details } }.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg = 'Dữ liệu gửi lên không hợp lệ.', details) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

export const unauthorized = (msg = 'Bạn cần đăng nhập để tiếp tục.') =>
  new AppError(401, 'UNAUTHORIZED', msg);

export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') =>
  new AppError(403, 'FORBIDDEN', msg);

/** Dùng cả cho "không tồn tại" lẫn "ngoài phạm vi" — không lộ sự tồn tại của bản ghi. */
export const notFound = (msg = 'Không tìm thấy dữ liệu.') =>
  new AppError(404, 'NOT_FOUND', msg);

export const conflict = (msg = 'Dữ liệu đã tồn tại.', details) =>
  new AppError(409, 'CONFLICT', msg, details);

export const tooLarge = (msg = 'Tệp vượt quá dung lượng cho phép.') =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', msg);

/** Vi phạm quy tắc nghiệp vụ (ngoài bán kính GPS mà không ghi chú, thiếu ảnh minh chứng…). */
export const unprocessable = (msg = 'Thao tác không hợp lệ.', details) =>
  new AppError(422, 'UNPROCESSABLE', msg, details);

export const mustChangePassword = () =>
  new AppError(428, 'MUST_CHANGE_PASSWORD', 'Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.');

export const tooManyRequests = (msg = 'Bạn thao tác quá nhanh, vui lòng thử lại sau.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);

export const serverError = (msg = 'Hệ thống gặp sự cố, vui lòng thử lại.') =>
  new AppError(500, 'INTERNAL', msg);
