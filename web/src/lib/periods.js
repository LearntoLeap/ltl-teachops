/**
 * periods.js — Khung TIẾT DẠY cho giao diện.
 *
 * Phải khớp server/src/lib/periods.js. Người xếp lịch chỉ chọn tiết; giờ thật
 * do server suy ra và lưu, vì chấm công tính trễ/sớm theo giờ đó.
 */
export const PERIODS = [
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

/** Giờ của một tiết, hoặc null nếu ngoài khung. */
export function periodTimes(no) {
  const n = Number(no);
  return PERIODS.find((p) => p.no === n) || null;
}

/** Suy ngược tiết từ giờ bắt đầu — cho các buổi tạo trước khi có tính năng tiết. */
export function periodOfStart(startTime) {
  const hhmm = String(startTime || '').slice(0, 5);
  return PERIODS.find((p) => p.start === hhmm)?.no || null;
}

/**
 * Nhãn ngắn của buổi dạy: "Tiết 3" nếu biết tiết, không thì rơi về khung giờ.
 * Dùng chung cho danh sách, thời khoá biểu và trang chi tiết.
 */
export function periodLabel(schedule) {
  const no = schedule?.period ?? periodOfStart(schedule?.start_time);
  if (no) return `Tiết ${no}`;
  const t = String(schedule?.start_time || '').slice(0, 5);
  return t || '—';
}
