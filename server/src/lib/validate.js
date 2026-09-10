/**
 * validate.js — Ép kiểu & kiểm tra dữ liệu đầu vào.
 * Dùng thay cho schema JSON của Fastify vì phần lớn endpoint nhận multipart
 * (mọi trường về dưới dạng chuỗi), cần một lớp ép kiểu thống nhất.
 */
import { badRequest } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function str(v, field, { required = false, max = 5000, min = 0, trim = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Thiếu thông tin bắt buộc: ${field}.`);
    return null;
  }
  let s = String(v);
  if (trim) s = s.trim();
  if (!s && required) throw badRequest(`Thiếu thông tin bắt buộc: ${field}.`);
  if (!s) return null;
  if (s.length < min) throw badRequest(`${field} phải có ít nhất ${min} ký tự.`);
  if (s.length > max) throw badRequest(`${field} quá dài (tối đa ${max} ký tự).`);
  return s;
}

export function uuid(v, field, { required = false } = {}) {
  const s = str(v, field, { required, max: 64 });
  if (s === null) return null;
  if (!UUID_RE.test(s)) throw badRequest(`${field} không hợp lệ.`);
  return s.toLowerCase();
}

export function int(v, field, { required = false, min = -2147483648, max = 2147483647, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Thiếu thông tin bắt buộc: ${field}.`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw badRequest(`${field} phải là số nguyên.`);
  }
  if (n < min || n > max) throw badRequest(`${field} phải nằm trong khoảng ${min}–${max}.`);
  return n;
}

export function num(v, field, { required = false, min = -Infinity, max = Infinity, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Thiếu thông tin bắt buộc: ${field}.`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`${field} phải là số.`);
  if (n < min || n > max) throw badRequest(`${field} phải nằm trong khoảng ${min}–${max}.`);
  return n;
}

/** Multipart gửi boolean dưới dạng chuỗi 'true'/'false'/'1'/'0'. */
export function bool(v, field, { required = false, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Thiếu thông tin bắt buộc: ${field}.`);
    return def;
  }
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  throw badRequest(`${field} phải là true hoặc false.`);
}

export function enumOf(v, field, allowed, { required = false, def = null } = {}) {
  const s = str(v, field, { required, max: 64 });
  if (s === null) return def;
  if (!allowed.includes(s)) {
    throw badRequest(`${field} không hợp lệ. Giá trị cho phép: ${allowed.join(', ')}.`);
  }
  return s;
}

export function dateStr(v, field, { required = false, def = null } = {}) {
  const s = str(v, field, { required, max: 10 });
  if (s === null) return def;
  if (!DATE_RE.test(s)) throw badRequest(`${field} phải theo định dạng YYYY-MM-DD.`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} không phải ngày hợp lệ.`);
  return s;
}

export function timeStr(v, field, { required = false, def = null } = {}) {
  const s = str(v, field, { required, max: 8 });
  if (s === null) return def;
  if (!TIME_RE.test(s)) throw badRequest(`${field} phải theo định dạng HH:MM.`);
  return s.length === 5 ? `${s}:00` : s;
}

export function email(v, field = 'Email', { required = true } = {}) {
  const s = str(v, field, { required, max: 200 });
  if (s === null) return null;
  const lower = s.toLowerCase();
  if (!EMAIL_RE.test(lower)) throw badRequest('Địa chỉ email không hợp lệ.');
  return lower;
}

/** Thời điểm ISO do client gửi (client_time, queued_at) — chỉ để tham chiếu. */
export function isoTime(v, field, { def = null } = {}) {
  const s = str(v, field, { max: 40 });
  if (s === null) return def;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return def;   // sai định dạng thì bỏ qua, không chặn nghiệp vụ
  return d.toISOString();
}

/** Chuỗi JSON trong multipart (ví dụ trường `items` của kiểm kê thiết bị). */
export function json(v, field, { required = false, def = null } = {}) {
  const s = str(v, field, { required, max: 200_000 });
  if (s === null) return def;
  try {
    return JSON.parse(s);
  } catch {
    throw badRequest(`${field} không phải JSON hợp lệ.`);
  }
}

/** Mảng UUID từ query (?ids=a,b,c) hoặc body. */
export function uuidList(v, field) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map((x, i) => uuid(String(x).trim(), `${field}[${i}]`, { required: true }));
}

/** Tham số phân trang chuẩn. */
export function paging(q = {}) {
  const page = int(q.page, 'page', { def: 1, min: 1, max: 100_000 }) || 1;
  const limit = int(q.limit, 'limit', { def: 50, min: 1, max: 200 }) || 50;
  return { page, limit, offset: (page - 1) * limit };
}

/** Khoảng ngày cho báo cáo; mặc định tháng hiện tại nếu không truyền. */
export function dateRange(q = {}) {
  let from = dateStr(q.from, 'from');
  let to = dateStr(q.to, 'to');
  if (!from || !to) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    from ||= `${y}-${pad(m + 1)}-01`;
    to ||= `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  }
  if (from > to) throw badRequest('Ngày bắt đầu phải trước ngày kết thúc.');
  return { from, to };
}

export { UUID_RE };
