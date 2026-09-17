/**
 * periods.js — Khung TIẾT DẠY dùng chung cho xếp lịch.
 *
 * Người xếp lịch chỉ chọn "Tiết 3", không gõ giờ. Nhưng chấm công tính trễ/sớm
 * theo `schedules.start_time`, nên mỗi tiết vẫn phải quy ra giờ thật để lưu.
 *
 * Khung tiết KHÔNG cố định trong mã nguồn: Quản trị viên sửa và THÊM tiết ngay
 * trong app (lưu ở app_settings key 'periods'). Mảng DEFAULT_PERIODS dưới đây
 * chỉ là khung khởi đầu — 45 phút/tiết, sáng 1-5, chiều 6-10.
 */
import { getSetting, patchSetting } from './settings.js';
import { badRequest } from './errors.js';

export const MIN_PERIOD = 1;
/** Trần kỹ thuật, khớp ràng buộc schedules_period_chk trong CSDL. */
export const MAX_PERIOD = 30;

const DEFAULT_PERIODS = [
  { no: 1, start: '07:00', end: '07:45' },
  { no: 2, start: '07:45', end: '08:30' },
  { no: 3, start: '08:40', end: '09:25' },
  { no: 4, start: '09:25', end: '10:10' },
  { no: 5, start: '10:10', end: '10:55' },
  { no: 6, start: '13:30', end: '14:15' },
  { no: 7, start: '14:15', end: '15:00' },
  { no: 8, start: '15:10', end: '15:55' },
  { no: 9, start: '15:55', end: '16:40' },
  { no: 10, start: '16:40', end: '17:25' },
];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Buổi của tiết suy từ giờ bắt đầu — chỉ để gom nhóm cho dễ nhìn. */
const sessionOf = (start) => (String(start) < '12:00' ? 'morning' : 'afternoon');

/**
 * Khung tiết đang áp dụng. Cấu hình hỏng (thiếu trường, sai giờ, trùng số tiết)
 * thì rơi về khung mặc định — thà xếp lịch bằng khung chuẩn còn hơn chết API.
 */
export async function listPeriods() {
  let raw;
  try {
    raw = (await getSetting('periods'))?.items;
  } catch {
    raw = null;
  }
  const items = normalize(raw);
  return (items || DEFAULT_PERIODS).map((p) => ({ ...p, session: sessionOf(p.start) }));
}

/** Kiểm tra và sắp xếp danh sách tiết; không hợp lệ ⇒ null. */
function normalize(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const no = Number(p?.no);
    const start = String(p?.start || '').slice(0, 5);
    const end = String(p?.end || '').slice(0, 5);
    if (!Number.isInteger(no) || no < MIN_PERIOD || no > MAX_PERIOD) return null;
    if (!HHMM.test(start) || !HHMM.test(end) || end <= start) return null;
    if (seen.has(no)) return null;
    seen.add(no);
    out.push({ no, start, end });
  }
  return out.sort((a, b) => a.no - b.no);
}

/**
 * Lưu khung tiết mới (Quản trị viên). Ném badRequest kèm lý do tiếng Việt nếu
 * danh sách không hợp lệ — người dùng sửa ngay trên màn hình.
 */
export async function savePeriods(raw, userId = null) {
  if (!Array.isArray(raw) || !raw.length) {
    throw badRequest('Khung tiết phải có ít nhất một tiết.');
  }
  if (raw.length > MAX_PERIOD) {
    throw badRequest(`Khung tiết tối đa ${MAX_PERIOD} tiết.`);
  }
  for (const p of raw) {
    const no = Number(p?.no);
    if (!Number.isInteger(no) || no < MIN_PERIOD || no > MAX_PERIOD) {
      throw badRequest(`Số tiết phải là số nguyên từ ${MIN_PERIOD} đến ${MAX_PERIOD}.`);
    }
    const start = String(p?.start || '').slice(0, 5);
    const end = String(p?.end || '').slice(0, 5);
    if (!HHMM.test(start) || !HHMM.test(end)) {
      throw badRequest(`Tiết ${no}: giờ phải ở dạng HH:MM.`);
    }
    if (end <= start) throw badRequest(`Tiết ${no}: giờ kết thúc phải sau giờ bắt đầu.`);
  }
  const items = normalize(raw);
  if (!items) throw badRequest('Khung tiết có số tiết bị trùng nhau.');
  await patchSetting('periods', { items }, userId);
  return items.map((p) => ({ ...p, session: sessionOf(p.start) }));
}

/** Giờ bắt đầu/kết thúc của một tiết; tiết không có trong khung ⇒ null. */
export async function periodTimes(no) {
  const n = Number(no);
  if (!Number.isInteger(n)) return null;
  const items = await listPeriods();
  const p = items.find((x) => x.no === n);
  return p ? { start: p.start, end: p.end } : null;
}

/** Suy ngược: giờ bắt đầu khớp tiết nào — dùng cho buổi tạo trước khi có tiết. */
export async function periodOfStart(startTime) {
  const hhmm = String(startTime || '').slice(0, 5);
  const items = await listPeriods();
  return items.find((p) => p.start === hhmm)?.no ?? null;
}
