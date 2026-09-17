/**
 * periods.js — Khung TIẾT DẠY dùng chung cho xếp lịch.
 *
 * Người xếp lịch chỉ chọn "Tiết 3", không phải gõ giờ. Nhưng chấm công tính
 * trễ/sớm theo `schedules.start_time`, nên mỗi tiết vẫn phải quy ra giờ thật và
 * lưu xuống bảng. Bảng dưới đây là khung phổ thông 45 phút/tiết:
 *
 *   Sáng   tiết 1-5 : 7:00 · 7:45 · 8:40 (sau ra chơi) · 9:25 · 10:10
 *   Chiều  tiết 6-10: 13:30 · 14:15 · 15:10 (sau ra chơi) · 15:55 · 16:40
 *
 * Trường nào lệch khung này thì sửa đúng một chỗ: mảng PERIODS.
 */

/** Tiết → { start, end } dạng 'HH:MM'. Chỉ số mảng = số tiết - 1. */
const PERIODS = [
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

export const MIN_PERIOD = 1;
export const MAX_PERIOD = PERIODS.length;

/** Danh sách tiết để đổ ra giao diện: [{ no, start, end, session }]. */
export const PERIOD_LIST = PERIODS.map((p) => ({ ...p, session: p.no <= 5 ? 'morning' : 'afternoon' }));

/** Giờ bắt đầu/kết thúc của một tiết; tiết ngoài khung ⇒ null. */
export function periodTimes(no) {
  const n = Number(no);
  if (!Number.isInteger(n) || n < MIN_PERIOD || n > MAX_PERIOD) return null;
  const p = PERIODS[n - 1];
  return { start: p.start, end: p.end };
}

/** Nhãn hiển thị: "Tiết 3 (08:40–09:25)". */
export function periodLabel(no) {
  const t = periodTimes(no);
  return t ? `Tiết ${no} (${t.start}–${t.end})` : `Tiết ${no}`;
}

/** Suy ngược: giờ bắt đầu 'HH:MM[:SS]' khớp tiết nào — dùng cho dữ liệu cũ. */
export function periodOfStart(startTime) {
  const hhmm = String(startTime || '').slice(0, 5);
  const hit = PERIODS.find((p) => p.start === hhmm);
  return hit ? hit.no : null;
}
