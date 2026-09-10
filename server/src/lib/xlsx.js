/**
 * xlsx.js — Sinh tệp Excel (.xlsx) cho các bảng dữ liệu.
 * Dùng ExcelJS, ghi thẳng vào reply stream để không giữ cả tệp trong RAM.
 *
 * Quy ước trình bày thống nhất toàn hệ thống:
 *   - Dòng 1: tiêu đề báo cáo (gộp ô, nền tím thương hiệu).
 *   - Dòng 2: phạm vi lọc + thời điểm xuất.
 *   - Dòng 4: tiêu đề cột (đậm, nền tím nhạt, đóng băng).
 */
import ExcelJS from 'exceljs';

const BRAND = 'FF8A3F97';
const BRAND_SOFT = 'FFF3E8F6';

/**
 * @param {object} reply       Reply của Fastify
 * @param {object} spec
 * @param {string} spec.fileName    Tên tệp tải về (chưa gồm .xlsx)
 * @param {string} spec.title       Tiêu đề in ở dòng 1
 * @param {string} [spec.subtitle]  Mô tả phạm vi lọc
 * @param {Array}  spec.columns     [{ header, key, width, format?, align? }]
 * @param {Array}  spec.rows        Mảng object theo `key` của columns
 * @param {Array}  [spec.sheets]    Nhiều sheet: [{ name, title, columns, rows }]
 */
export async function sendXlsx(reply, spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LtL TeachOps';
  wb.created = new Date();

  const sheets = spec.sheets?.length
    ? spec.sheets
    : [{ name: spec.sheetName || 'Dữ liệu', title: spec.title, subtitle: spec.subtitle, columns: spec.columns, rows: spec.rows }];

  for (const s of sheets) buildSheet(wb, s);

  const safeName = String(spec.fileName || 'bao-cao')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // bỏ dấu tiếng Việt trong tên tệp
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80);

  reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${safeName}.xlsx"`)
    .header('Cache-Control', 'no-store');

  await wb.xlsx.write(reply.raw);
  reply.raw.end();
  return reply;
}

function buildSheet(wb, s) {
  // Tên sheet Excel không cho phép : \ / ? * [ ] và tối đa 31 ký tự.
  const ws = wb.addWorksheet(String(s.name || 'Dữ liệu').replace(/[:\\/?*[\]]/g, '-').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const cols = s.columns || [];
  const lastCol = Math.max(cols.length, 1);

  // Dòng 1 — tiêu đề
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = s.title || 'Báo cáo';
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  // Dòng 2 — phạm vi + thời điểm xuất
  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = [s.subtitle, `Xuất lúc ${formatVN(new Date())}`].filter(Boolean).join('  ·  ');
  sub.font = { size: 10, italic: true, color: { argb: 'FF6B6480' } };
  sub.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 18;

  // Dòng 4 — tiêu đề cột
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width || 16 }));
  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: 'FF4F2A78' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thin();
  });
  head.height = 30;

  // Dữ liệu từ dòng 5
  (s.rows || []).forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key] ?? '';
      cell.border = thin();
      cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', wrapText: c.wrap === true };
      if (c.format) cell.numFmt = c.format;
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF8FC' } };
      }
    });
  });

  // Bộ lọc tự động trên hàng tiêu đề
  if (cols.length && (s.rows || []).length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } };
  }
}

function thin() {
  const c = { style: 'thin', color: { argb: 'FFE4D9E9' } };
  return { top: c, left: c, bottom: c, right: c };
}

/** 10/09/2026 14:35 */
export function formatVN(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** 10/09/2026 */
export function formatVNDate(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, dd] = s.slice(0, 10).split('-');
    return `${dd}/${m}/${y}`;
  }
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
}

/** 14:35 */
export function formatVNTime(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** Nhãn tiếng Việt dùng chung khi xuất Excel. */
export const LABELS = {
  role: { admin: 'Quản trị viên', manager: 'Phòng chuyên môn', teacher: 'Giáo viên', assistant: 'Trợ giảng' },
  label: { ontime: 'Đúng giờ', late: 'Trễ', absent: 'Vắng' },
  level: { primary: 'Tiểu học', secondary: 'THCS', highschool: 'THPT' },
  approval: { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' },
  issue: { new: 'Mới', in_progress: 'Đang xử lý', resolved: 'Đã khắc phục' },
  priority: { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' },
  category: { curriculum: 'Giáo trình', device: 'Thiết bị', other: 'Khác' },
  slot: {
    morning_start: 'Đầu buổi sáng', morning_end: 'Cuối buổi sáng',
    afternoon_start: 'Đầu buổi chiều', afternoon_end: 'Cuối buổi chiều',
  },
  area: { official: 'Phòng chuyên môn', teacher: 'Giáo viên' },
};
