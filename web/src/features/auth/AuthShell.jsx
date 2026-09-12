/**
 * AuthShell.jsx — Khung chung cho các màn hình chưa đăng nhập:
 * nền gradient tím thương hiệu + robot minh hoạ + thẻ trắng ở giữa.
 */
export default function AuthShell({ title, sub, children }) {
  return (
    <div className="min-h-dvh bg-brand-grad flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center text-white mb-6">
          <div className="text-5xl mb-3" aria-hidden>🤖</div>
          <h1 className="text-2xl font-extrabold tracking-tight">LtL TeachOps</h1>
          <div className="text-[13px] opacity-90 mt-1">
            Learn to Leap · Quản lý vận hành giáo viên & trợ giảng
          </div>
        </div>

        <div className="bg-white rounded-xl3 shadow-card-lg p-6 animate-slide-up">
          {title && <h2 className="text-lg font-bold mb-1">{title}</h2>}
          {sub && <p className="text-[13px] text-ink-muted mb-4">{sub}</p>}
          {children}
        </div>

        <div className="text-center text-white/70 text-[11.5px] mt-6">
          © {new Date().getFullYear()} Công ty CP Công nghệ Giáo dục Learn to Leap
          {' · '}
          <a href="/chinh-sach-bao-mat" className="underline hover:text-white">Chính sách bảo mật</a>
        </div>
      </div>
    </div>
  );
}
