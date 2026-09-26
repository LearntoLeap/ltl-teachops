/**
 * AuthShell.jsx — Khung chung cho các màn hình chưa đăng nhập:
 * nền gradient tím thương hiệu + robot minh hoạ + thẻ trắng ở giữa.
 */
export default function AuthShell({ title, sub, children }) {
  return (
    <div className="min-h-dvh bg-brand-grad flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Mảng sáng nền cho có chiều sâu, không cản thao tác */}
      <span className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <span className="pointer-events-none absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="w-full max-w-sm relative">
        <div className="text-center text-white mb-6">
          <div className="text-5xl mb-3" aria-hidden>🤖</div>
          <h1 className="text-2xl font-extrabold tracking-tight">LtL TeachOps</h1>
          <div className="text-sm opacity-90 mt-1">
            Learn to Leap · Quản lý vận hành giáo viên & trợ giảng
          </div>
        </div>

        <div className="bg-white rounded-xl3 shadow-card-lg p-6 animate-pop-in">
          {title && <h2 className="text-xl font-extrabold mb-1 tracking-tight">{title}</h2>}
          {sub && <p className="text-sm text-ink-muted mb-4 leading-relaxed">{sub}</p>}
          {children}
        </div>

        <div className="text-center text-white/70 text-xs mt-6">
          © {new Date().getFullYear()} Công ty CP Công nghệ Giáo dục Learn to Leap
          {' · '}
          <a href="/chinh-sach-bao-mat" className="underline hover:text-white">Chính sách bảo mật</a>
        </div>
      </div>
    </div>
  );
}
