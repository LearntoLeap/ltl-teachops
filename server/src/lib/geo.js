/**
 * geo.js — Tính khoảng cách GPS và nhãn giờ chấm công.
 * Toàn bộ tính toán chạy ở SERVER; giờ máy người dùng chỉ để tham chiếu.
 */

const R = 6_371_000; // bán kính Trái Đất (m)
const rad = (d) => (d * Math.PI) / 180;

/** Khoảng cách haversine giữa hai toạ độ, đơn vị mét (làm tròn). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== 'number' || !isFinite(v))) return null;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Toạ độ có hợp lệ không (đề phòng client gửi 0,0 khi GPS lỗi). */
export function isValidCoord(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    isFinite(lat) && isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Ghép ngày (YYYY-MM-DD) + giờ (HH:MM[:SS]) thành mốc thời gian theo giờ Việt Nam (UTC+7).
 * Container api chạy TZ=Asia/Ho_Chi_Minh nhưng ta cộng bù tường minh để không phụ thuộc cấu hình.
 */
export function vnDateTime(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm, ss] = String(timeStr).split(':').map(Number);
  // Date.UTC rồi trừ 7 giờ ⇒ đúng thời điểm tuyệt đối của giờ VN.
  return new Date(Date.UTC(y, m - 1, d, hh - 7, mm || 0, ss || 0));
}

/**
 * Nhãn chấm công dựa trên giờ check-in thực tế so với giờ theo lịch.
 * @returns {{ lateMinutes: number, label: 'ontime'|'late' }}
 */
export function labelCheckIn(checkInAt, sessionDate, startTime, graceMinutes = 10) {
  const planned = vnDateTime(sessionDate, startTime);
  const diffMin = Math.round((checkInAt.getTime() - planned.getTime()) / 60_000);
  const lateMinutes = Math.max(0, diffMin);
  return { lateMinutes, label: lateMinutes > graceMinutes ? 'late' : 'ontime' };
}

/** Số phút làm việc thực tế giữa check-in và check-out. */
export function workMinutes(checkInAt, checkOutAt) {
  if (!checkInAt || !checkOutAt) return null;
  return Math.max(0, Math.round((new Date(checkOutAt) - new Date(checkInAt)) / 60_000));
}
