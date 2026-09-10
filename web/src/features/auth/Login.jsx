/**
 * Login.jsx — Đăng nhập bằng email + mật khẩu do Admin cấp. Không có đăng ký.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { Field, Spinner } from '../../components/ui.jsx';
import AuthShell from './AuthShell.jsx';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim() || !password) {
      setError('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }
    setBusy(true);
    try {
      await auth.signIn(email.trim().toLowerCase(), password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại, vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Đăng nhập" sub="Dùng tài khoản email do Quản trị viên cấp.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" required>
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="ten@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Mật khẩu" required>
          <div className="relative">
            <input
              className="input !pr-11"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink px-1"
              aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
              {showPw ? '🙈' : '👁️'}
            </button>
          </div>
        </Field>

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[13px] px-3.5 py-2.5 mb-3">
            ⚠ {error}
          </div>
        )}

        <button className="btn-primary w-full !py-3" disabled={busy}>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Đăng nhập'}
        </button>
      </form>

      <div className="text-center mt-4">
        <Link to="/quen-mat-khau" className="text-[13px] text-brand-700 font-semibold hover:underline">
          Quên mật khẩu?
        </Link>
      </div>

      <div className="mt-4 rounded-xl bg-brand-50 px-3.5 py-3 text-[12px] text-ink-soft">
        💡 Chưa có tài khoản? Hệ thống không cho tự đăng ký — hãy liên hệ Quản trị viên
        hoặc Phòng chuyên môn để được cấp tài khoản.
      </div>
    </AuthShell>
  );
}
