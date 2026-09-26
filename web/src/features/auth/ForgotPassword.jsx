/**
 * ForgotPassword.jsx — Gửi email đặt lại mật khẩu.
 * Server luôn trả 204 (không lộ email tồn tại hay không) — thông báo trung tính.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Field, Spinner } from '../../components/ui.jsx';
import AuthShell from './AuthShell.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim()) { setError('Vui lòng nhập email.'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Không gửi được yêu cầu, vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Quên mật khẩu" sub="Nhập email tài khoản để nhận liên kết đặt lại mật khẩu.">
      {sent ? (
        <div className="text-center py-2">
          <div className="text-4xl mb-3">📬</div>
          <p className="text-base text-ink-soft mb-4">
            Nếu email <b>{email.trim()}</b> tồn tại trong hệ thống, liên kết đặt lại mật khẩu
            đã được gửi tới hộp thư. Liên kết có hiệu lực trong <b>60 phút</b>.
          </p>
          <p className="text-sm text-ink-muted mb-4">
            Không thấy email? Kiểm tra mục Spam/Thư rác, hoặc liên hệ Quản trị viên để được cấp lại mật khẩu.
          </p>
          <Link to="/dang-nhap" className="btn-primary w-full">← Về trang đăng nhập</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="Email" required>
            <input className="input" type="email" inputMode="email" autoComplete="username"
              placeholder="ten@gmail.com" value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3.5 py-2.5 mb-3">
              ⚠ {error}
            </div>
          )}
          <button className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Gửi liên kết đặt lại'}
          </button>
          <div className="text-center mt-4">
            <Link to="/dang-nhap" className="text-sm text-brand-700 font-semibold hover:underline">
              ← Về trang đăng nhập
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
