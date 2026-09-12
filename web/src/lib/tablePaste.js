/**
 * tablePaste.js — Tiện ích dùng chung cho các màn hình nhập dạng bảng
 * (lịch dạy, trường, lớp, học liệu): đọc vùng ô dán từ Excel và dò tên gần đúng.
 */

/** Bỏ dấu tiếng Việt, chữ thường, gọn khoảng trắng — để so khớp tên gần đúng. */
export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Tìm id theo tên (hoặc mã) gần đúng: khớp trọn trước, rồi mới tới "chứa".
 * @returns {string} id tìm được, '' nếu không khớp
 */
export function findByName(list, name, keys = ['name', 'full_name']) {
  const n = norm(name);
  if (!n) return '';
  const hit = list.find((x) => keys.some((k) => norm(x[k]) === n))
    || list.find((x) => keys.some((k) => norm(x[k]).includes(n)));
  return hit?.id || '';
}

/**
 * Đọc dữ liệu clipboard dạng bảng của Excel/Google Sheets (TSV):
 * cột cách nhau bằng Tab, ô chứa xuống dòng được bọc trong "…".
 * Bỏ các dòng trống hoàn toàn.
 */
export function parseTsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === '\t') {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out
    .map((r) => r.map((x) => x.trim()))
    .filter((r) => r.some(Boolean));
}

/** Dán nhiều ô (có Tab hoặc nhiều dòng) mới xử lý như bảng; dán 1 ô để trình duyệt tự làm. */
export const isTablePaste = (text) => !!text && (text.includes('\t') || /\r?\n./.test(text.trim()));

/** Khối 1-5 → Tiểu học · 6-9 → THCS · 10-12 → THPT. */
export const levelOfGrade = (g) => (g <= 5 ? 'primary' : g <= 9 ? 'secondary' : 'highschool');

/** 'Tiểu học' / 'TH' / 'THCS' / 'THPT' / 'primary'… → mã cấp học; không hiểu thì ''. */
export function parseLevel(v) {
  const n = norm(v).replace(/[^a-z]/g, '');
  if (!n) return '';
  if (['th', 'tieuhoc', 'primary', 'c1', 'cap1'].includes(n)) return 'primary';
  if (['thcs', 'secondary', 'c2', 'cap2'].includes(n)) return 'secondary';
  if (['thpt', 'highschool', 'c3', 'cap3'].includes(n)) return 'highschool';
  return '';
}

/** Lấy số nguyên đầu tiên trong chuỗi ('Khối 6', 'K6', '6') → 6; không có → ''. */
export function firstInt(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? Number(m[0]) : '';
}
