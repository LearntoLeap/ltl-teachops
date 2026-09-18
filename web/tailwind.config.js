/**
 * Bảng màu Learn to Leap — TÍM chủ đạo, nền trắng kiểu trang quản trị.
 * Thang brand là tím thuần (trước đây 50–500 ngả hồng nên nền, viền, nút
 * đều ám hồng và cả trang trông đục).
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
        ink: { DEFAULT: '#18181b', soft: '#3f3f46', muted: '#71717a' },
        night: { DEFAULT: '#1e1537', deep: '#150f29', line: '#2e2350' },
        line: '#e4e4e7',
        canvas: '#f7f7f9',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)',
        'brand-grad-soft': 'linear-gradient(135deg,#a78bfa 0%,#7c3aed 100%)',
      },
      boxShadow: {
        card: '0 4px 12px rgba(24,24,27,.06), 0 1px 2px rgba(24,24,27,.04)',
        'card-lg': '0 16px 40px rgba(24,24,27,.14)',
        'card-sm': '0 1px 2px rgba(24,24,27,.05)',
      },
      borderRadius: { xl2: '12px', xl3: '18px' },
      keyframes: {
        'slide-up': { from: { transform: 'translateY(16px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'slide-up': 'slide-up .24s ease-out',
        'fade-in': 'fade-in .18s ease-out',
      },
    },
  },
  plugins: [],
};
