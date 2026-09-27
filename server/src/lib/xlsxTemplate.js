/**
 * xlsxTemplate.js — Biến tệp mẫu nhập liệu thành "bảng có hướng dẫn":
 *   • Cột ngày khoá định dạng YYYY-MM-DD, gõ kiểu nào Excel cũng hiện đúng kiểu đó.
 *   • Cột lớp / tiết / giáo viên / trợ giảng / phòng có DANH SÁCH THẢ XUỐNG lấy
 *     thẳng từ cơ sở dữ liệu của app.
 *
 * Danh sách nằm ở một sheet ẩn (DanhMuc). Ô vẫn cho gõ tên ngoài danh sách —
 * giáo viên/trợ giảng chưa có tài khoản thì cứ gõ, hệ thống nhận tên gõ tay.
 */

const LIST_SHEET = 'DanhMuc';
export const TEMPLATE_FIRST_ROW = 5;    // dòng dữ liệu đầu tiên (khớp buildSheet)
export const TEMPLATE_LAST_ROW = 204;   // đủ cho 200 dòng nhập một lượt

/**
 * @param {Workbook} wb  workbook của exceljs
 * @param {string} sheetName  tên sheet nhập liệu
 * @param {Array<{col:number, values?:string[], date?:boolean, title?:string}>} columns
 */
export function attachPickers(wb, sheetName, columns) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return;

  let listWs = wb.getWorksheet(LIST_SHEET);
  if (!listWs) {
    listWs = wb.addWorksheet(LIST_SHEET);
    listWs.state = 'veryHidden';        // người dùng không thấy, Excel vẫn đọc được
  }

  let listCol = listWs.actualColumnCount || 0;

  for (const spec of columns) {
    let validation = null;

    if (spec.date) {
      // Khoá định dạng: gõ 30/9/2026 hay 9/30/2026 đều hiện ra 2026-09-30.
      ws.getColumn(spec.col).numFmt = 'yyyy-mm-dd';
      validation = {
        type: 'date',
        operator: 'between',
        allowBlank: true,
        showErrorMessage: false,        // gõ sai vẫn cho nhập, chỉ nhắc khi tạo
        formulae: [new Date(2000, 0, 1), new Date(2100, 0, 1)],
        promptTitle: spec.title || 'Ngày',
        prompt: 'Định dạng YYYY-MM-DD, ví dụ 2026-09-30.',
        showInputMessage: true,
      };
    } else if (spec.values?.length) {
      listCol += 1;
      listWs.getCell(1, listCol).value = spec.title || 'Danh mục';
      spec.values.forEach((v, i) => { listWs.getCell(i + 2, listCol).value = v; });
      const colLetter = letterOf(listCol);
      validation = {
        type: 'list',
        allowBlank: true,
        // showErrorMessage: false ⇒ có thả xuống để CHỌN, nhưng vẫn gõ tay được.
        showErrorMessage: false,
        formulae: [`=${LIST_SHEET}!$${colLetter}$2:$${colLetter}$${spec.values.length + 1}`],
        promptTitle: spec.title || 'Chọn',
        prompt: 'Bấm mũi tên để chọn, hoặc gõ tên mới nếu chưa có trong danh sách.',
        showInputMessage: true,
      };
    }

    if (!validation) continue;
    for (let r = TEMPLATE_FIRST_ROW; r <= TEMPLATE_LAST_ROW; r++) {
      ws.getCell(r, spec.col).dataValidation = validation;
    }
  }
}

/** 1 → A, 27 → AA (đủ dùng cho vài chục danh mục). */
function letterOf(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
