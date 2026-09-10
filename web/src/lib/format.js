/**
 * format.js — Định dạng hiển thị và nhãn tiếng Việt dùng chung.
 * Mọi màn hình phải dùng các hàm ở đây, không tự định dạng ngày/giờ riêng.
 */

const pad = (n) => String(n).padStart(2, '0');

/** '2026-09-10' hoặc ISO → '10/09/2026' */
export function fmtDate(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** ISO → '14:35' */
export function fmtTime(v) {
  if (!v) return '';
  const s = String(v);
  // Cột TIME của Postgres về dạng 'HH:MM:SS'
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO → '10/09/2026 14:35' */
export function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

/** '07:30:00' + '09:00:00' → '07:30 – 09:00' */
export function fmtRange(start, end) {
  const a = fmtTime(start);
  const b = fmtTime(end);
  return a && b ? `${a} – ${b}` : a || b || '';
}

/** Khoảng cách thời gian dễ đọc: '3 phút trước', '2 giờ trước', '10/09/2026' */
export function fmtAgo(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} ngày trước`;
  return fmtDate(d);
}

/** 'Thứ Năm, 10/09/2026' */
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
export function fmtDateLong(v) {
  if (!v) return '';
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${WEEKDAYS[d.getDay()]}, ${fmtDate(d)}`;
}

/** Ngày hôm nay dạng 'YYYY-MM-DD' theo giờ máy. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ngày đầu & cuối tháng chứa `v`. */
export function monthRange(v = new Date()) {
  const d = new Date(v);
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`,
  };
}

/** 1234 → '1.234' */
export function fmtNumber(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('vi-VN');
}

/** 1250 → '1,25 km'; 180 → '180 m' */
export function fmtDistance(m) {
  if (m === null || m === undefined) return '—';
  const n = Number(m);
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n / 1000).toFixed(2).replace('.', ',')} km`;
}

/** 95 → '1 giờ 35 phút' */
export function fmtDuration(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '—';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${r} phút`;
  if (!r) return `${h} giờ`;
  return `${h} giờ ${r} phút`;
}

/** 1.2 MB */
export function fmtSize(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------ Nhãn tiếng Việt ---------------------------- */
export const LABEL = {
  role: { admin: 'Quản trị viên', manager: 'Phòng chuyên môn', teacher: 'Giáo viên', assistant: 'Trợ giảng' },
  level: { primary: 'Tiểu học', secondary: 'THCS', highschool: 'THPT' },
  classRole: { teacher: 'Giáo viên', assistant: 'Trợ giảng' },
  attend: { ontime: 'Đúng giờ', late: 'Trễ', absent: 'Vắng' },
  approval: { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' },
  issue: { new: 'Mới', in_progress: 'Đang xử lý', resolved: 'Đã khắc phục' },
  priority: { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' },
  category: { curriculum: 'Giáo trình', device: 'Thiết bị', other: 'Khác' },
  area: { official: 'Phòng chuyên môn', teacher: 'Giáo viên' },
  slot: {
    morning_start: 'Đầu buổi sáng', morning_end: 'Cuối buổi sáng',
    afternoon_start: 'Đầu buổi chiều', afternoon_end: 'Cuối buổi chiều',
  },
  scheduleStatus: { scheduled: 'Theo lịch', done: 'Đã dạy', cancelled: 'Đã huỷ' },
  solutionGroup: { ubtech: 'UBTECH', stickem: "Stick'em", weeemake: 'Weeemake', other: 'Khác' },
};

/** Màu badge theo trạng thái — dùng lớp Tailwind. */
export const TONE = {
  ontime:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  late:        'bg-amber-50 text-amber-700 ring-amber-200',
  absent:      'bg-rose-50 text-rose-700 ring-rose-200',
  pending:     'bg-amber-50 text-amber-700 ring-amber-200',
  approved:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected:    'bg-rose-50 text-rose-700 ring-rose-200',
  new:         'bg-sky-50 text-sky-700 ring-sky-200',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  resolved:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
  low:         'bg-slate-50 text-slate-600 ring-slate-200',
  normal:      'bg-sky-50 text-sky-700 ring-sky-200',
  high:        'bg-amber-50 text-amber-700 ring-amber-200',
  urgent:      'bg-rose-50 text-rose-700 ring-rose-200',
  neutral:     'bg-brand-50 text-brand-700 ring-brand-200',
};

/** Chữ cái đầu của tên để làm avatar: 'Lê Văn Trí' → 'T' */
export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  return (parts[parts.length - 1][0] || '?').toUpperCase();
}
