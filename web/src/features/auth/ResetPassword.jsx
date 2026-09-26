/**
 * ResetPassword.jsx — Đặt mật khẩu mới từ liên kết trong email (?token=...).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Field, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import AuthShell from './AuthShell.jsx';

export function passwordIssue(pw, confirm) {
  if (!pw || pw.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu phải gồm cả chữ và số.';
  if (confirm !== undefined && pw !== confirm) return 'Mật khẩu nhập lại không khớp.';
  return null;
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') || '', [params]);
  const navigate = useNavigate();
  const toast = useToast();

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const issue = passwordIssue(pw, pw2);
    if (issue) { setError(issue); return; }
    setError('');
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, new_password: pw });
      toast.ok('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
      navigate('/dang-nhap', { replace: true });
    } catch (err) {
      setError(err.message || 'Không đặt lại được mật khẩu.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Liên kết không hợp lệ">
        <p className="text-base text-ink-soft mb-4">
          Liên kết đặt lại mật khẩu thiếu hoặc đã hỏng. Hãy yêu cầu gửi lại từ trang Quên mật khẩu.
        </p>
        <Link to="/quen-mat-khau" className="btn-primary w-full">Yêu cầu liên kết mới</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Đặt mật khẩu mới" sub="Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số.">
      <form onSubmit={submit} noValidate>
        <Field label="Mật khẩu mới" required>
          <input className="input" type="password" autoComplete="new-password"
            value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Field label="Nhập lại mật khẩu mới" required>
          <input className="input" type="password" autoComplete="new-password"
            value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3.5 py-2.5 mb-3">
            ⚠ {error}
          </div>
        )}
        <button className="btn-primary w-full !py-3" disabled={busy}>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Xác nhận'}
        </button>
      </form>
    </AuthShell>
  );
}
