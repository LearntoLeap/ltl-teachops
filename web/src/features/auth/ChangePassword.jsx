/**
 * ChangePassword.jsx — Đổi mật khẩu.
 * Chế độ `forced`: hiển thị toàn màn hình khi must_change_password=true (lần đầu đăng nhập
 * hoặc sau khi được cấp lại mật khẩu tạm) — không thể bỏ qua, chỉ có thể đăng xuất.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { Field, PageHeader, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import AuthShell from './AuthShell.jsx';
import { passwordIssue } from './ResetPassword.jsx';

export default function ChangePassword({ forced = false }) {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!current) { setError('Vui lòng nhập mật khẩu hiện tại.'); return; }
    const issue = passwordIssue(pw, pw2);
    if (issue) { setError(issue); return; }
    if (pw === current) { setError('Mật khẩu mới phải khác mật khẩu hiện tại.'); return; }
    setError('');
    setBusy(true);
    try {
      await auth.changePassword(current, pw);
      toast.ok('Đã đổi mật khẩu thành công.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Không đổi được mật khẩu.');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={submit} noValidate>
      <Field label={forced ? 'Mật khẩu tạm được cấp' : 'Mật khẩu hiện tại'} required>
        <input className="input" type="password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </Field>
      <Field label="Mật khẩu mới" required hint="Tối thiểu 8 ký tự, gồm cả chữ và số.">
        <input className="input" type="password" autoComplete="new-password"
          value={pw} onChange={(e) => setPw(e.target.value)} />
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
        {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Đổi mật khẩu'}
      </button>
    </form>
  );

  if (forced) {
    return (
      <AuthShell
        title={`Xin chào ${auth.user?.full_name || ''}! 👋`}
        sub="Vì lý do bảo mật, bạn cần đổi mật khẩu trước khi bắt đầu sử dụng hệ thống.">
        {form}
        <button className="btn-ghost w-full mt-3" onClick={() => auth.signOut()}>
          Đăng xuất
        </button>
      </AuthShell>
    );
  }

  return (
    <div className="max-w-md">
      <PageHeader title="Đổi mật khẩu" sub="Mật khẩu mới áp dụng ngay cho lần đăng nhập sau." />
      <div className="card p-5">{form}</div>
    </div>
  );
}
