/**
 * auth.jsx — Ngữ cảnh phiên đăng nhập dùng chung toàn app.
 *
 * Cung cấp: user, permissions, đăng nhập/đăng xuất, kiểm tra quyền `can()`.
 * Quyền ở đây CHỈ để ẩn/hiện nút — server vẫn kiểm tra lại mọi thao tác.
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, tokens, cachedUser, onSession } from './api.js';

const AuthCtx = createContext(null);

export const ROLE_LABEL = {
  admin: 'Quản trị viên',
  manager: 'Phòng chuyên môn',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
};

export function AuthProvider({ children }) {
  // Khởi tạo từ bộ nhớ cục bộ để không nháy màn hình đăng nhập khi tải lại trang.
  const [user, setUser] = useState(() => cachedUser.get());
  const [loading, setLoading] = useState(() => !!tokens.access);
  const [needPasswordChange, setNeedPasswordChange] = useState(false);

  /** Nạp lại hồ sơ từ server (nguồn sự thật về quyền & phạm vi trường). */
  const reload = useCallback(async () => {
    if (!tokens.access) { setUser(null); setLoading(false); return null; }
    try {
      const me = await api.get('/api/auth/me');
      setUser(me);
      cachedUser.set(me);
      setNeedPasswordChange(!!me.must_change_password);
      return me;
    } catch (err) {
      if (err.mustChangePassword) {
        setNeedPasswordChange(true);
        // Vẫn giữ thông tin đã lưu để hiển thị tên trên màn hình đổi mật khẩu.
        return cachedUser.get();
      }
      if (err.isAuth) { setUser(null); cachedUser.set(null); }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Lắng nghe sự kiện phiên từ lớp api (token hết hạn, buộc đổi mật khẩu).
  useEffect(() => onSession((evt) => {
    if (evt === 'signed-out') { setUser(null); cachedUser.set(null); setNeedPasswordChange(false); }
    if (evt === 'must-change-password') setNeedPasswordChange(true);
  }), []);

  const signIn = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    tokens.set(data);
    cachedUser.set(data.user);
    setUser(data.user);
    setNeedPasswordChange(!!data.must_change_password);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/api/auth/logout', { refresh_token: tokens.refresh }); } catch { /* vẫn đăng xuất cục bộ */ }
    tokens.clear();
    setUser(null);
    setNeedPasswordChange(false);
  }, []);

  const changePassword = useCallback(async (current_password, new_password) => {
    const data = await api.post('/api/auth/change-password', { current_password, new_password });
    if (data?.access_token) tokens.set(data);
    setNeedPasswordChange(false);
    await reload();
    return data;
  }, [reload]);

  const value = useMemo(() => {
    const perms = new Set(user?.permissions || []);
    return {
      user,
      loading,
      needPasswordChange,
      role: user?.role || null,
      roleLabel: user ? ROLE_LABEL[user.role] : '',
      schools: user?.schools || [],
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager',
      isFieldStaff: user?.role === 'teacher' || user?.role === 'assistant',
      can: (perm) => perms.has(perm),
      canAny: (...list) => list.some((p) => perms.has(p)),
      signIn,
      signOut,
      changePassword,
      reload,
    };
  }, [user, loading, needPasswordChange, signIn, signOut, changePassword, reload]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}
