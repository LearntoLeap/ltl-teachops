/**
 * shiftDevices.js — Thiết bị THEO LOẠI khi chấm công vào / ra.
 *
 * Giáo viên không nhập một con số tổng nữa mà đếm TỪNG LOẠI: bao nhiêu robot
 * UGOT, bao nhiêu laptop, tablet… Danh sách gợi ý lấy từ:
 *   1. danh mục thiết bị của trường (device_catalog) — kèm số lượng CHUẨN;
 *   2. các loại thiết bị dùng chung (device_suggestions) — để thêm loại còn thiếu.
 * Cuối buổi đếm lại; loại nào ít hơn đầu buổi là THIẾU — phải ghi lý do.
 */
import { rows } from '../db.js';
import { badRequest } from './errors.js';

const MAX_ROWS = 60;
const MAX_QTY = 10_000;

/** Chuẩn hoá tên để so khớp đầu buổi ↔ cuối buổi ("Laptop" ≡ "laptop "). */
const keyOf = (name) => String(name || '').trim().toLowerCase();

/**
 * Đọc danh sách thiết bị gửi lên (chuỗi JSON trong multipart). Trả null nếu
 * client không gửi — để client cũ (và hàng đợi offline tạo trước bản này) vẫn
 * chấm công được bằng con số tổng như trước.
 */
export function parseDevices(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw badRequest('Vui lòng điền số lượng thực tế cho từng loại thiết bị.');
    return null;
  }
  let list;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw badRequest('Danh sách thiết bị không đúng định dạng.');
  }
  if (!Array.isArray(list)) throw badRequest('Danh sách thiết bị không đúng định dạng.');
  if (!list.length) throw badRequest('Vui lòng điền số lượng thực tế cho ít nhất một loại thiết bị.');
  if (list.length > MAX_ROWS) throw badRequest(`Tối đa ${MAX_ROWS} loại thiết bị.`);

  const seen = new Set();
  const out = [];
  for (const it of list) {
    const name = String(it?.name ?? '').trim().slice(0, 80);
    if (!name) throw badRequest('Mỗi dòng thiết bị phải có tên loại.');
    const key = keyOf(name);
    if (seen.has(key)) throw badRequest(`Loại "${name}" bị nhập hai lần.`);
    seen.add(key);

    const qty = Number(it?.qty);
    if (it?.qty === '' || it?.qty === null || it?.qty === undefined || !Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
      throw badRequest(`"${name}": số lượng thực tế phải là số nguyên từ 0 đến ${MAX_QTY}.`);
    }
    const row = { name, qty, unit: String(it?.unit || '').trim().slice(0, 20) || null };
    if (it?.catalog_id) row.catalog_id = String(it.catalog_id).slice(0, 64);
    if (Number.isInteger(Number(it?.expected)) && it?.expected !== null && it?.expected !== '') {
      row.expected = Number(it.expected);
    }
    out.push(row);
  }
  return out;
}

export const totalOf = (list) => (list || []).reduce((n, d) => n + (Number(d.qty) || 0), 0);

/**
 * So cuối buổi với đầu buổi: loại nào đếm được ÍT hơn là thiếu.
 * Loại có đầu buổi mà cuối buổi bỏ trống cũng tính là thiếu toàn bộ.
 */
export function shortagesOf(inList, outList) {
  if (!inList?.length || !outList) return [];
  const outByKey = new Map(outList.map((d) => [keyOf(d.name), d]));
  const miss = [];
  for (const d of inList) {
    const o = outByKey.get(keyOf(d.name));
    const outQty = o ? Number(o.qty) || 0 : 0;
    if (outQty < (Number(d.qty) || 0)) {
      miss.push({ name: d.name, unit: d.unit, in: Number(d.qty) || 0, out: outQty, diff: (Number(d.qty) || 0) - outQty });
    }
  }
  return miss;
}

/** "Laptop 15 · Robot UGOT 6" — dùng cho báo cáo và nhật ký. */
export function describe(list) {
  if (!list?.length) return '';
  return list.map((d) => `${d.name} ${d.qty}`).join(' · ');
}

/** "thiếu Laptop 2 chiếc, UGOT 1 bộ" */
export function describeShortage(miss) {
  return miss.map((m) => `${m.name} ${m.diff}${m.unit ? ` ${m.unit}` : ''} (${m.out}/${m.in})`).join(', ');
}

/**
 * Gợi ý cho màn chấm công: danh mục của trường (có số chuẩn) + loại dùng chung.
 * Icon của mục danh mục lấy theo loại dùng chung trùng tên (nếu có).
 */
export async function deviceOptions(schoolId) {
  const [catalog, suggestions] = await Promise.all([
    rows(
      `select dc.id, dc.name, dc.unit, dc.expected_qty, dc.room_id, r.name as room_name
         from device_catalog dc
         left join stem_rooms r on r.id = dc.room_id
        where dc.school_id = $1 and dc.is_active
        order by dc.sort_order, dc.name`,
      [schoolId]
    ),
    rows(
      `select name, category, unit, icon from device_suggestions
        where is_active order by sort_order, name`
    ),
  ]);
  const iconOf = new Map(suggestions.map((s) => [keyOf(s.name), s.icon]));
  return {
    catalog: catalog.map((c) => ({
      catalog_id: c.id,
      name: c.name,
      unit: c.unit,
      expected: c.expected_qty,
      room_name: c.room_name,
      icon: iconOf.get(keyOf(c.name)) || null,
    })),
    suggestions,
  };
}
