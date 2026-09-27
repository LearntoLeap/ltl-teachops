/**
 * xlsxRead.js — Đọc tệp Excel người dùng tải lên thành các DÒNG CHỮ.
 *
 * Chủ ý: chỉ bóc ra mảng ô dạng chuỗi, KHÔNG suy diễn ý nghĩa. Màn hình nhập
 * bảng sẽ ánh xạ chữ → lớp / giáo viên / phòng bằng đúng đoạn mã đang dùng cho
 * thao tác dán (Ctrl+V), nên hai lối vào luôn cho cùng kết quả.
 *
 * Tệp mẫu do hệ thống phát ra có 1–3 dòng tiêu đề trước hàng tên cột, và vài
 * dòng ví dụ — hàm này tự tìm hàng tên cột, bỏ dòng ví dụ và dòng rỗng, rồi
 * báo lại bằng `warnings` để người dùng biết cái gì đã bị bỏ qua.
 */
import ExcelJS from 'exceljs';

const MAX_ROWS = 500;

/** Bỏ dấu, gộp khoảng trắng, bỏ dấu * — để so tên cột "dễ tính". */
const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/gi, 'd')
  .replace(/[*()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/** Giá trị một ô → chuỗi gọn (xử lý ngày, công thức, chữ nhiều đoạn). */
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.hyperlink) return String(v.text || v.hyperlink).trim();
    return '';
  }
  return String(v).trim();
}

/**
 * Đọc bảng đầu tiên trong tệp.
 * @param {Buffer} buffer tệp .xlsx
 * @param {string[]} headers tên cột mong đợi, đúng thứ tự (dùng để tìm hàng tiêu đề)
 * @returns {{ rows: string[][], warnings: string[] }}
 */
export async function readTable(buffer, headers = []) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], warnings: ['Tệp không có bảng nào.'] };

  const width = Math.max(headers.length, ws.columnCount || headers.length, 1);
  const all = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
    all.push(cells);
  });

  const warnings = [];
  const wanted = headers.map(norm).filter(Boolean);

  // Hàng tên cột = hàng khớp nhiều tên cột nhất (và ít nhất một nửa).
  let headerAt = -1;
  let best = 0;
  all.forEach((cells, i) => {
    const hit = wanted.filter((h) => cells.some((c) => norm(c) && (norm(c) === h || norm(c).startsWith(h) || h.startsWith(norm(c))))).length;
    if (hit > best) { best = hit; headerAt = i; }
  });
  if (headerAt < 0 || best < Math.max(1, Math.ceil(wanted.length / 2))) {
    headerAt = -1;
    warnings.push('Không tìm thấy hàng tên cột — đang đọc theo đúng thứ tự cột của mẫu.');
  }

  let data = headerAt >= 0 ? all.slice(headerAt + 1) : all;

  // Bỏ dòng tiêu đề phụ / dòng rỗng / dòng ví dụ trong mẫu.
  const before = data.length;
  data = data.filter((cells) => cells.some((c) => c !== ''));
  const examples = data.filter((cells) => cells.some((c) => /\(?\s*(ví dụ|vi du)\s*\)?/i.test(c)));
  if (examples.length) {
    data = data.filter((cells) => !examples.includes(cells));
    warnings.push(`Đã bỏ ${examples.length} dòng ví dụ có sẵn trong mẫu.`);
  }
  const emptied = before - data.length - examples.length;
  if (emptied > 0) warnings.push(`Đã bỏ ${emptied} dòng trống.`);

  if (data.length > MAX_ROWS) {
    warnings.push(`Tệp có ${data.length} dòng — chỉ lấy ${MAX_ROWS} dòng đầu.`);
    data = data.slice(0, MAX_ROWS);
  }
  return { rows: data, warnings };
}
