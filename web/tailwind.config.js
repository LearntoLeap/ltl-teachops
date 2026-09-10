/** Bảng màu thương hiệu Learn to Leap — tím chủ đạo. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf3f9',
          100: '#fbe5f1',
          200: '#f6cce4',
          300: '#eda3d0',
          400: '#df78b9',
          500: '#cd5aa3',
          600: '#b0428f',
          700: '#8c3b90',
          800: '#6a3a99',
          900: '#4f2a78',
          950: '#311a48',
        },
        ink: { DEFAULT: '#1e1b2e', soft: '#4b4565', muted: '#857e9e' },
        line: '#efe7f0',
        canvas: '#f9f5fb',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg,#ee6c98 0%,#a94f9f 50%,#6f3fa2 100%)',
        'brand-grad-soft': 'linear-gradient(135deg,#e86ba0 0%,#7e44a3 100%)',
      },
      boxShadow: {
        card: '0 6px 22px rgba(99,40,117,.12)',
        'card-lg': '0 14px 40px rgba(99,40,117,.20)',
        'card-sm': '0 2px 8px rgba(99,40,117,.09)',
      },
      borderRadius: { xl2: '18px', xl3: '26px' },
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
