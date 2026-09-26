/**
 * Charts.jsx — Biểu đồ tổng quan cho trang chủ, vẽ bằng SVG thuần.
 *
 * Không dùng thư viện đồ thị: chỉ vài hình chữ nhật và cung tròn, nhẹ và
 * hiển thị được ngay cả khi mạng yếu. Màu lấy từ token (src/theme/tokens.css),
 * không có mã màu viết cứng.
 *
 *   <BarChart series={...} />  — 14 ngày gần đây: cột tiết dạy · phần đã điểm danh
 *   <DonutChart mix={...} />   — tỉ lệ đúng giờ / trễ / vắng trong tháng
 *
 * Cả hai đều có bản chữ cho trình đọc màn hình (sr-only) và tự thu gọn trên
 * điện thoại (bỏ bớt nhãn ngày, giữ nguyên số cột).
 */

const fmtDay = (iso) => {
  const [, m, d] = String(iso || '').split('-');
  return d && m ? `${Number(d)}/${Number(m)}` : '';
};

/* ------------------------------- Biểu đồ cột ------------------------------- */
/**
 * Mỗi ngày một cột: chiều cao = số tiết dạy, phần tô đậm = số tiết đã điểm danh.
 * Người xem nhìn một cái là thấy ngày nào dạy nhiều, ngày nào điểm danh còn thiếu.
 */
export function BarChart({ series = [], height = 140, className = '' }) {
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((d) => d.sessions || 0));
  const n = series.length;
  const gap = 4;
  const W = 100;                       // toạ độ tương đối, SVG tự co theo khung
  const bw = (W - gap * (n - 1)) / n;
  const todayIdx = n - 1;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} 44`} preserveAspectRatio="none" role="img"
        style={{ width: '100%', height }} aria-label="Số tiết dạy 14 ngày gần đây">
        {[0, 11, 22, 33, 44].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="rgb(var(--line))" strokeWidth=".4" />
        ))}
        {series.map((d, i) => {
          const x = i * (bw + gap);
          const h = ((d.sessions || 0) / max) * 40;
          const hd = ((d.attended || 0) / max) * 40;
          return (
            <g key={d.day}>
              <title>{`${fmtDay(d.day)} · ${d.sessions || 0} tiết · đã điểm danh ${d.attended || 0}`}</title>
              <rect x={x} y={44 - h} width={bw} height={h} rx="1"
                fill={i === todayIdx ? 'rgb(var(--brand-300))' : 'rgb(var(--brand-100))'} />
              <rect x={x} y={44 - hd} width={bw} height={hd} rx="1" fill="rgb(var(--brand-600))" />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between text-[10.5px] text-ink-muted mt-1 tabular-nums">
        {series.map((d, i) => (
          <span key={d.day} className={i % 2 ? 'hidden sm:inline' : ''}>{fmtDay(d.day)}</span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted mt-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Đã điểm danh
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-100 ring-1 ring-inset ring-brand-200" /> Tiết theo lịch
        </span>
      </div>

      <span className="sr-only">
        {series.map((d) => `${fmtDay(d.day)}: ${d.sessions || 0} tiết, đã điểm danh ${d.attended || 0}.`).join(' ')}
      </span>
    </div>
  );
}

/* ------------------------------ Biểu đồ tròn ------------------------------- */
const SLICES = [
  { key: 'ontime', label: 'Đúng giờ', color: 'rgb(var(--success))' },
  { key: 'late', label: 'Trễ', color: 'rgb(var(--warning))' },
  { key: 'absent', label: 'Vắng', color: 'rgb(var(--error))' },
];

/** Vòng tròn khuyết giữa: tỉ lệ đúng giờ / trễ / vắng của tháng đang chạy. */
export function DonutChart({ mix, size = 132, className = '' }) {
  const parts = SLICES.map((s) => ({ ...s, value: Number(mix?.[s.key]) || 0 }));
  const total = parts.reduce((n, p) => n + p.value, 0);
  const R = 16;                      // bán kính vòng (chu vi ≈ 100 cho dễ tính)
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <svg viewBox="0 0 42 42" style={{ width: size, height: size }} role="img"
        aria-label="Tỉ lệ chấm công tháng này">
        <circle cx="21" cy="21" r={R} fill="none" stroke="rgb(var(--neutral-200))" strokeWidth="6" />
        {total > 0 && parts.map((p) => {
          if (!p.value) return null;
          const len = (p.value / total) * C;
          const el = (
            <circle key={p.key} cx="21" cy="21" r={R} fill="none" stroke={p.color} strokeWidth="6"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 21 21)" strokeLinecap="butt">
              <title>{`${p.label}: ${p.value}/${total}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="21" y="20.2" textAnchor="middle" className="fill-ink"
          style={{ fontSize: '7px', fontWeight: 800 }}>
          {total ? Math.round((parts[0].value / total) * 100) : 0}%
        </text>
        <text x="21" y="25.5" textAnchor="middle" className="fill-ink-muted" style={{ fontSize: '3.4px' }}>
          đúng giờ
        </text>
      </svg>

      <div className="grid gap-1.5 min-w-0">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-ink-soft flex-1">{p.label}</span>
            <b className="tabular-nums text-ink">{p.value}</b>
          </div>
        ))}
        <div className="text-xs text-ink-muted border-t border-line pt-1.5 mt-0.5">
          Tổng <b className="text-ink-soft tabular-nums">{total}</b> buổi trong tháng
        </div>
      </div>
    </div>
  );
}
