/**
 * periods.js — Khung TIẾT DẠY cho giao diện.
 *
 * Khung thật do Quản trị viên cấu hình (GET /api/periods). Ở đây chỉ giữ một
 * bản đệm trong bộ nhớ để các màn hình hiển thị "Tiết 3" mà không phải chờ
 * mạng, cùng khung mặc định dùng tạm trước khi tải xong.
 */
import { api } from './api.js';

export const DEFAULT_PERIODS = [
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

/** Buổi của tiết số `no`: tiết 1–5 là buổi sáng, tiết 6 trở đi là buổi chiều. */
export const sessionOfNo = (no) => (Number(no) <= 5 ? 'morning' : 'afternoon');

/**
 * Buổi của một tiết trong lịch: ưu tiên máy chủ đã tính (work_session), rồi
 * theo số tiết; tiết cũ không có số tiết thì theo giờ (trước 12:00 là sáng).
 */
export function sessionOfSchedule(s) {
  if (s?.work_session) return s.work_session;
  if (s?.period) return sessionOfNo(s.period);
  return String(s?.start_time || '').slice(0, 5) < '12:00' ? 'morning' : 'afternoon';
}

let cache = DEFAULT_PERIODS;
let inflight = null;

/** Khung tiết đã tải gần nhất — dùng ngay, không chờ. */
export const cachedPeriods = () => cache;

/** Tải khung tiết từ máy chủ (gộp các lời gọi trùng nhau). */
export function loadPeriods() {
  if (!inflight) {
    inflight = api.get('/api/periods')
      .then((r) => {
        const items = Array.isArray(r?.items) ? r.items : [];
        if (items.length) cache = items;
        return cache;
      })
      .catch(() => cache)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Bắt máy chủ đọc lại ở lần sau (sau khi Quản trị viên lưu khung mới). */
export function resetPeriods(items) {
  if (Array.isArray(items) && items.length) cache = items;
}

export function periodTimes(no) {
  const n = Number(no);
  return cache.find((p) => p.no === n) || null;
}

/** Suy ngược tiết từ giờ bắt đầu — cho buổi tạo trước khi có tính năng tiết. */
export function periodOfStart(startTime) {
  const hhmm = String(startTime || '').slice(0, 5);
  return cache.find((p) => p.start === hhmm)?.no || null;
}

/** Nhãn ngắn: "Tiết 3" nếu biết tiết, không thì rơi về giờ bắt đầu. */
export function periodLabel(schedule) {
  const no = schedule?.period ?? periodOfStart(schedule?.start_time);
  if (no) return `Tiết ${no}`;
  const t = String(schedule?.start_time || '').slice(0, 5);
  return t || '—';
}
