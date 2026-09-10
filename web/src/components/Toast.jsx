/**
 * Toast.jsx — Thông báo nổi góc màn hình. Dùng: const toast = useToast(); toast.ok('Đã lưu');
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastCtx = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback((type, message, ms = 3200) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-3), { id, type, message }]);
    timers.current[id] = setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    ok: (m, ms) => push('ok', m, ms),
    err: (m, ms) => push('err', m, ms ?? 5000),
    info: (m, ms) => push('info', m, ms),
    /** Hiển thị message của ApiError, kèm phương án dự phòng. */
    fromError: (e, fallback = 'Có lỗi xảy ra, vui lòng thử lại.') =>
      push('err', e?.message || fallback, 5000),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed z-[90] left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none"
           style={{ bottom: 'calc(84px + var(--safe-bot))' }}>
        {items.map((t) => (
          <div key={t.id}
               onClick={() => dismiss(t.id)}
               className={
                 'pointer-events-auto cursor-pointer animate-slide-up rounded-xl px-4 py-2.5 text-sm font-medium shadow-card-lg max-w-[92vw] text-center ' +
                 (t.type === 'ok' ? 'bg-emerald-600 text-white'
                  : t.type === 'err' ? 'bg-rose-600 text-white'
                  : 'bg-ink text-white')
               }>
            {t.type === 'ok' ? '✓ ' : t.type === 'err' ? '⚠ ' : ''}{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast phải nằm trong <ToastProvider>');
  return ctx;
}
