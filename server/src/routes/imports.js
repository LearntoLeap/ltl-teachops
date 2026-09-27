/**
 * routes/imports.js — Tải TỆP EXCEL lên cho các màn "Nhập bảng".
 *
 * Nguyên tắc: tải lên KHÔNG tạo dữ liệu ngay. Máy chủ chỉ đọc tệp thành các
 * dòng chữ rồi trả về; người dùng xem lại trên bảng, sửa chỗ thiếu, bấm tạo.
 * Nhờ vậy tệp thiếu thông tin vẫn tải lên được — chỉ bị NHẮC, không bị chặn.
 *
 * Thứ tự cột phải khớp tệp mẫu (/api/<mục>/batch-template).
 */
import { requirePerm } from '../lib/rbac.js';
import { badRequest } from '../lib/errors.js';
import { readTable } from '../lib/xlsxRead.js';

const MAX_FILE = 5 * 1024 * 1024;   // 5MB — bảng nhập liệu không bao giờ to hơn thế

/** Mỗi loại: quyền cần có, tên cột của mẫu, và nhãn để báo lỗi. */
const KINDS = {
  schools: {
    perm: 'org.manage',
    label: 'trường',
    headers: ['Mã trường', 'Tên trường', 'Địa chỉ', 'Tỉnh / Thành phố',
      'Toạ độ GPS', 'Bán kính chấm công', 'Phút ân hạn trễ', 'Người liên hệ', 'SĐT liên hệ'],
  },
  classes: {
    perm: 'org.manage',
    label: 'lớp',
    headers: ['Mã trường', 'Tên lớp', 'Khối', 'Cấp học', 'Sĩ số',
      'Giáo viên phụ trách', 'Trợ giảng phụ trách', 'Ghi chú'],
  },
  schedules: {
    perm: 'schedule.manage',
    label: 'lịch dạy',
    headers: ['Ngày', 'Tiết', 'Lớp', 'Giáo viên', 'Trợ giảng', 'Phòng', 'Nội dung'],
  },
};

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * POST /api/import/table?kind=schools|classes|schedules
   * multipart: file = .xlsx
   * → { rows: [[ô, ô, …], …], warnings: [...], headers: [...] }
   * ---------------------------------------------------------------------- */
  app.post('/api/import/table', async (req, reply) => {
    const kind = String(req.query.kind || '').trim();
    const spec = KINDS[kind];
    if (!spec) throw badRequest('Loại dữ liệu nhập không hợp lệ.');

    // Quyền theo từng loại — dùng lại đúng quyền của màn nhập bảng tương ứng.
    await requirePerm(spec.perm)(req, reply);

    if (!req.isMultipart()) throw badRequest('Vui lòng chọn tệp Excel (.xlsx) để tải lên.');
    const part = await req.file({ limits: { fileSize: MAX_FILE } });
    if (!part) throw badRequest('Không nhận được tệp nào.');
    if (!/\.xlsx?$/i.test(part.filename || '')) {
      throw badRequest(`Chỉ nhận tệp Excel (.xlsx). Hãy tải mẫu nhập ${spec.label} rồi điền vào đó.`);
    }

    const buffer = await part.toBuffer();
    if (part.file?.truncated) throw badRequest('Tệp quá lớn — tối đa 5MB.');

    let parsed;
    try {
      parsed = await readTable(buffer, spec.headers);
    } catch {
      throw badRequest('Không đọc được tệp. Hãy lưu lại dạng .xlsx rồi thử lại.');
    }
    // Tệp rỗng KHÔNG bị chặn — chỉ nhắc, đúng tinh thần "tải lên trước, sửa sau".
    if (!parsed.rows.length) {
      parsed.warnings.push('Tệp chưa có dòng dữ liệu nào ngoài phần tiêu đề và ví dụ.');
    }
    return { kind, headers: spec.headers, rows: parsed.rows, warnings: parsed.warnings };
  });
}
