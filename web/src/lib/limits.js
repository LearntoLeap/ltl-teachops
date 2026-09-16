/**
 * limits.js — Giới hạn dung lượng tải lên, khớp biến môi trường của máy chủ
 * (MAX_UPLOAD_MB / MAX_VIDEO_MB / MAX_MATERIAL_MB). Kiểm tra trước ở trình duyệt để báo
 * lỗi rõ ràng ngay lúc chọn tệp, thay vì gửi cả trăm MB rồi mới bị từ chối.
 */
export const MB = 1024 * 1024;
export const MAX_IMAGE_MB = 15;          // ảnh (máy chủ tự nén) và tài liệu ở mục khác
export const MAX_FIELD_VIDEO_MB = 100;   // video minh chứng: điểm danh, báo hỏng, góp ý
export const MAX_MATERIAL_MB = 500;      // học liệu: slide, giáo án, video bài giảng

const fmt = (bytes) => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;

/** Tệp học liệu có vượt giới hạn không? Trả câu báo lỗi, hoặc null nếu hợp lệ. */
export function materialFileProblem(file) {
  if (!file) return null;
  const isImg = (file.type || '').startsWith('image/');
  const limit = isImg ? MAX_IMAGE_MB : MAX_MATERIAL_MB;
  if (file.size > limit * MB) {
    return `"${file.name}" nặng ${fmt(file.size)} — tối đa ${limit} MB${isImg ? ' với ảnh' : ''}. `
      + 'Hãy nén/cắt nhỏ tệp hoặc chia thành nhiều phần.';
  }
  return null;
}
