/**
 * ui.jsx — Bộ thành phần giao diện nhỏ dùng chung toàn app.
 * Badge, Spinner, EmptyState, PageHeader, Field, Sheet (modal trượt), ConfirmSheet,
 * Pager, SearchBox, Segmented.
 */
import { useEffect, useRef, useState } from 'react';
import { TONE } from '../lib/format.js';

/* --------------------------------- Badge ---------------------------------- */
export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`badge ${TONE[tone] || TONE.neutral} ${className}`}>{children}</span>
  );
}

/* -------------------------------- Spinner --------------------------------- */
export function Spinner({ className = '' }) {
  return (
    <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 align-middle ${className}`} />
  );
}

export function PageLoading({ label = 'Đang tải dữ liệu…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted">
      <Spinner className="h-7 w-7" />
      <div className="text-sm">{label}</div>
    </div>
  );
}

/* ------------------------------- EmptyState -------------------------------- */
export function EmptyState({ icon = '🗂️', title = 'Chưa có dữ liệu', hint, action }) {
  return (
    <div className="card flex flex-col items-center justify-center py-12 px-6 text-center gap-2">
      <div className="text-4xl">{icon}</div>
      <div className="font-semibold text-ink-soft">{title}</div>
      {hint && <div className="text-[13px] text-ink-muted max-w-xs">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ------------------------------- PageHeader -------------------------------- */
export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 className="text-lg font-bold text-ink">{title}</h1>
        {sub && <div className="text-[13px] text-ink-muted mt-0.5">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------- Field ---------------------------------- */
export function Field({ label, required, hint, error, children }) {
  return (
    <div className="mb-3.5">
      {label && (
        <label className="label">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <div className="text-[12px] text-ink-muted mt-1">{hint}</div>}
      {error && <div className="text-[12px] text-rose-600 mt-1">{error}</div>}
    </div>
  );
}

/* ---------------------------------- Sheet ---------------------------------- */
/**
 * Modal trượt từ dưới lên (mobile) / hộp giữa màn hình (desktop).
 * <Sheet open={open} onClose={...} title="..."> nội dung </Sheet>
 */
export function Sheet({ open, onClose, title, children, wide = false }) {
  const [visible, setVisible] = useState(open);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
    } else {
      setShow(false);
      const t = setTimeout(() => setVisible(false), 240);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!visible) return null;
  return (
    <div
      className={`fixed inset-0 z-[70] flex items-end sm:items-center justify-center transition-colors duration-200 ${show ? 'bg-black/45' : 'bg-transparent'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className={`bg-white w-full sm:rounded-xl3 rounded-t-xl3 shadow-card-lg overflow-hidden
                    transition-transform duration-200 flex flex-col
                    ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}
                    ${show ? 'translate-y-0' : 'translate-y-8 sm:translate-y-4 sm:opacity-0'}`}
        style={{ maxHeight: 'min(92vh, 100dvh - 24px)' }}>
        <div className="sm:hidden pt-2.5 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 pt-3.5 pb-2">
            <div className="font-bold text-[16px]">{title}</div>
            <button className="text-ink-muted hover:text-ink text-xl leading-none px-1" onClick={onClose} aria-label="Đóng">×</button>
          </div>
        )}
        <div className="px-5 pb-5 overflow-y-auto" style={{ paddingBottom: 'calc(20px + var(--safe-bot))' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ ConfirmSheet -------------------------------- */
export function ConfirmSheet({ open, onClose, onConfirm, title = 'Xác nhận', message, danger = false, confirmLabel = 'Đồng ý', busy = false }) {
  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={title}>
      <p className="text-[14px] text-ink-soft mb-5">{message}</p>
      <div className="flex gap-2.5 justify-end">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------------------------- Pager ---------------------------------- */
export function Pager({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 50)));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-4 text-sm">
      <button className="btn-line !px-3 !py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span className="text-ink-muted">Trang {page}/{pages}</span>
      <button className="btn-line !px-3 !py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
  );
}

/* --------------------------------- SearchBox -------------------------------- */
export function SearchBox({ value, onChange, placeholder = 'Tìm kiếm…', className = '' }) {
  const [v, setV] = useState(value || '');
  const t = useRef(null);
  useEffect(() => setV(value || ''), [value]);
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">🔍</span>
      <input
        className="input !pl-9"
        value={v}
        placeholder={placeholder}
        onChange={(e) => {
          setV(e.target.value);
          clearTimeout(t.current);
          t.current = setTimeout(() => onChange(e.target.value), 350);
        }}
      />
    </div>
  );
}

/* -------------------------------- Segmented --------------------------------- */
export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex rounded-xl bg-brand-50 p-1 gap-0.5 overflow-x-auto max-w-full ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 rounded-[10px] text-[13px] font-semibold whitespace-nowrap transition
            ${value === o.value ? 'bg-white text-brand-800 shadow-card-sm' : 'text-ink-muted hover:text-brand-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- ErrorBox ----------------------------------- */
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="card border-rose-200 bg-rose-50/60 p-4 text-center">
      <div className="text-[14px] text-rose-700 font-medium mb-2">⚠ {error.message || 'Có lỗi xảy ra.'}</div>
      {onRetry && <button className="btn-line !py-1.5" onClick={onRetry}>Thử lại</button>}
    </div>
  );
}
