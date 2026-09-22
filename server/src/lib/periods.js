/**
 * periods.js — Khung TIẾT DẠY dùng cho xếp lịch.
 *
 * Người xếp lịch chỉ chọn "Tiết 3", không gõ giờ. Nhưng chấm công và điểm danh
 * cần giờ thật, nên mỗi tiết phải quy ra giờ để lưu xuống buổi dạy.
 *
 * Giờ của tiết tra theo thứ tự ưu tiên:
 *   1. BỘ GIỜ HỌC THEO MÙA của đúng trường, đang hiệu lực vào ngày dạy
 *      (bảng school_period_sets / school_period_times — Quản trị viên và Phòng
 *      chuyên môn tự thêm: mùa hè, mùa đông khác nhau).
 *   2. Khung chung của hệ thống (app_settings.periods — Quản trị viên sửa).
 *   3. DEFAULT_PERIODS bên dưới — khung phổ thông 45 phút/tiết.
 */
import { one, rows } from '../db.js';
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
const hhmm = (t) => String(t || '').slice(0, 5);

/** Buổi của tiết suy từ giờ bắt đầu — chỉ để gom nhóm cho dễ nhìn. */
// Tiết 1–5 là buổi sáng, tiết 6 trở đi là buổi chiều (quy ước chấm công theo buổi).
const sessionOf = (no) => (Number(no) <= 5 ? 'morning' : 'afternoon');
const withSession = (list) => list.map((p) => ({ ...p, session: sessionOf(p.no) }));

/**
 * Kiểm tra + sắp xếp một danh sách tiết. Không hợp lệ ⇒ ném badRequest kèm lý do
 * tiếng Việt (dùng khi lưu); `lenient` = trả null thay vì ném (dùng khi đọc).
 */
export function normalizePeriods(raw, { lenient = false } = {}) {
  const fail = (msg) => { if (lenient) return null; throw badRequest(msg); };
  if (!Array.isArray(raw) || !raw.length) return fail('Bộ giờ học phải có ít nhất một tiết.');
  if (raw.length > MAX_PERIOD) return fail(`Tối đa ${MAX_PERIOD} tiết.`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const no = Number(p?.no);
    if (!Number.isInteger(no) || no < MIN_PERIOD || no > MAX_PERIOD) {
      return fail(`Số tiết phải là số nguyên từ ${MIN_PERIOD} đến ${MAX_PERIOD}.`);
    }
    const start = hhmm(p?.start ?? p?.start_time);
    const end = hhmm(p?.end ?? p?.end_time);
    if (!HHMM.test(start) || !HHMM.test(end)) return fail(`Tiết ${no}: giờ phải ở dạng HH:MM.`);
    if (end <= start) return fail(`Tiết ${no}: giờ kết thúc phải sau giờ bắt đầu.`);
    if (seen.has(no)) return fail(`Tiết ${no} bị trùng.`);
    seen.add(no);
    out.push({ no, start, end });
  }
  return out.sort((a, b) => a.no - b.no);
}

/** Khung chung của hệ thống (khi trường chưa có bộ giờ theo mùa). */
async function systemPeriods() {
  let raw = null;
  try { raw = (await getSetting('periods'))?.items; } catch { raw = null; }
  return normalizePeriods(raw, { lenient: true }) || DEFAULT_PERIODS;
}

/** Bộ giờ theo mùa của trường đang hiệu lực vào ngày đó, hoặc null. */
export async function activeSchoolSet(schoolId, date) {
  if (!schoolId || !date) return null;
  // Nhiều bộ chồng ngày thì bộ bắt đầu MUỘN NHẤT thắng — bộ mới đè bộ cũ.
  const set = await one(
    `select id, name, valid_from, valid_to from school_period_sets
      where school_id = $1 and is_active and $2::date between valid_from and valid_to
      order by valid_from desc, created_at desc limit 1`,
    [schoolId, date]
  );
  if (!set) return null;
  const times = await rows(
    'select no, start_time, end_time from school_period_times where set_id = $1 order by no',
    [set.id]
  );
  if (!times.length) return null;
  return {
    ...set,
    items: times.map((t) => ({ no: t.no, start: hhmm(t.start_time), end: hhmm(t.end_time) })),
  };
}

/**
 * Khung tiết áp dụng cho (trường, ngày). Trả về kèm nguồn để giao diện nói rõ
 * đang dùng bộ giờ nào: { items, source: 'school'|'system', set_name? }.
 */
export async function listPeriods({ schoolId = null, date = null } = {}) {
  const set = await activeSchoolSet(schoolId, date);
  if (set) {
    return { items: withSession(set.items), source: 'school', set_id: set.id, set_name: set.name };
  }
  return { items: withSession(await systemPeriods()), source: 'system' };
}

/** Lưu khung CHUNG của hệ thống (Quản trị viên). */
export async function savePeriods(raw, userId = null) {
  const items = normalizePeriods(raw);
  await patchSetting('periods', { items }, userId);
  return withSession(items);
}

/** Giờ của một tiết cho (trường, ngày); tiết không có trong khung ⇒ null. */
export async function periodTimes(no, ctx = {}) {
  const n = Number(no);
  if (!Number.isInteger(n)) return null;
  const { items } = await listPeriods(ctx);
  const p = items.find((x) => x.no === n);
  return p ? { start: p.start, end: p.end } : null;
}
