/**
 * Cấu hình Tailwind — CHỈ ÁNH XẠ token, không tự định nghĩa giá trị màu.
 * Mọi mã màu nằm ở src/theme/tokens.css; ở đây chỉ đặt tên lớp tiện dùng.
 * Nhờ ghi màu dạng 3 kênh RGB, các lớp có độ mờ (bg-brand-600/40) vẫn chạy.
 */

/** Sinh thang màu từ biến CSS: brand-50…brand-950 */
const scale = (name) => Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
    .map((step) => [step, `rgb(var(--${name}-${step}) / <alpha-value>)`])
);
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: scale('brand'),        // tím THAO TÁC — nút, liên kết, focus
        accent: scale('accent'),      // tím THƯƠNG HIỆU — sidebar, gradient
        // Xám ngả tím thay cho xám lạnh mặc định: mọi lớp zinc-*/slate-* đã có
        // trong mã nguồn tự đổi tông, không phải sửa từng file.
        zinc: scale('neutral'),
        slate: scale('neutral'),
        neutral: scale('neutral'),
        ink: { DEFAULT: token('ink'), soft: token('ink-soft'), muted: token('ink-muted') },
        night: { DEFAULT: token('night'), deep: token('night-deep'), line: token('night-line') },
        line: token('line'),
        canvas: token('canvas'),
        surface: token('surface'),
        success: token('success'),
        warning: token('warning'),
        error: token('error'),
        info: token('info'),
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      // 6 bậc cỡ chữ; nội dung đọc dài có line-height ≥ 1.5.
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.55' }],
        base: ['14.5px', { lineHeight: '1.6' }],
        lg: ['16px', { lineHeight: '1.55' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['26px', { lineHeight: '1.3' }],
      },
      backgroundImage: {
        // Gradient nhận diện: tím thao tác → tím thương hiệu, đúng tông logo.
        'brand-grad': 'linear-gradient(135deg, rgb(var(--brand-500)) 0%, rgb(var(--accent-600)) 100%)',
        'brand-grad-soft': 'linear-gradient(135deg, rgb(var(--brand-400)) 0%, rgb(var(--accent-500)) 100%)',
      },
      boxShadow: {
        'card-sm': 'var(--shadow-1)',
        card: 'var(--shadow-2)',
        'card-lg': 'var(--shadow-3)',
      },
      borderRadius: {
        lg: 'var(--radius-sm)',    // 8px
        xl2: 'var(--radius-md)',   // 12px
        xl3: 'var(--radius-lg)',   // 16px
      },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      transitionDuration: { fast: 'var(--dur-fast)', base: 'var(--dur-base)', slow: 'var(--dur-slow)' },
      keyframes: {
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { transform: 'scale(.96)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
      },
      animation: {
        'slide-up': 'slide-up var(--dur-slow) var(--ease-out) both',
        'fade-in': 'fade-in var(--dur-base) var(--ease-out) both',
        'pop-in': 'pop-in var(--dur-base) var(--ease-out) both',
      },
    },
  },
  plugins: [],
};
