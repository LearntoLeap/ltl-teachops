/**
 * ui.jsx — Bộ thành phần giao diện nhỏ dùng chung toàn app.
 * Badge, Spinner, Skeleton, EmptyState, PageHeader, Field, Sheet (modal trượt),
 * ConfirmSheet, Pager, SearchBox, Segmented, ErrorBox.
 *
 * Quy ước trình bày (áp dụng cho mọi màn):
 *   - Màu, bo góc, đổ bóng, thời lượng chuyển động lấy từ src/theme/tokens.css.
 *   - Vùng chạm trên điện thoại ≥ 44px (lớp .btn và .icon-btn trong index.css).
 *   - Chuyển động ≤ 250ms, tự tắt khi máy bật "giảm chuyển động".
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

/* -------------------------------- Skeleton --------------------------------- */
/** Khối xám lấp lánh, giữ chỗ đúng hình dạng nội dung sắp hiện ra. */
export function Skeleton({ className = '' }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

/** Vài dòng skeleton cho danh sách / thẻ. */
export function SkeletonList({ rows = 3, className = '' }) {
  return (
    <div className={`grid gap-2.5 ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl2 shrink-0" />
          <span className="flex-1 min-w-0 grid gap-1.5">
            <Skeleton className="h-3.5 w-1/3 rounded" />
            <Skeleton className="h-3 w-2/3 rounded" />
          </span>
          <Skeleton className="h-6 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton dạng bảng cho vùng chờ có nhiều cột. */
export function SkeletonTable({ rows = 5, cols = 4, className = '' }) {
  return (
    <div className={`card overflow-hidden ${className}`} aria-hidden>
      <div className="flex gap-3 px-3 py-2.5 bg-zinc-50 border-b border-line">
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-3 flex-1 rounded" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 px-3 py-3 border-t border-line first:border-t-0">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className={`h-3.5 flex-1 rounded ${i === 0 ? 'max-w-[40%]' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageLoading({ label = 'Đang tải dữ liệu…' }) {
  return (
    <div className="py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 text-ink-muted text-sm mb-3">
        <Spinner className="h-4 w-4" /> {label}
      </div>
      <SkeletonList rows={3} />
    </div>
  );
}

/* ------------------------------- EmptyState -------------------------------- */
export function EmptyState({ icon = '🗂️', title = 'Chưa có dữ liệu', hint, action }) {
  return (
    <div className="card flex flex-col items-center justify-center py-12 px-6 text-center gap-2 animate-fade-in">
      <span className="relative grid place-items-center h-20 w-20 mb-1">
        <span className="absolute inset-0 rounded-full bg-brand-grad opacity-[.10]" aria-hidden />
        <span className="absolute inset-3 rounded-full bg-brand-50" aria-hidden />
        <span className="relative text-[34px] leading-none">{icon}</span>
      </span>
      <div className="font-bold text-ink">{title}</div>
      {hint && <div className="text-sm text-ink-muted max-w-sm leading-relaxed">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ------------------------------- PageHeader -------------------------------- */
export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold text-ink tracking-tight">{title}</h1>
        {sub && <div className="text-sm text-ink-muted mt-0.5">{sub}</div>}
      </div>
      {/* Nút hành động phải xuống dòng được, nếu không sẽ đẩy tràn trang trên điện thoại. */}
      {actions && <div className="flex flex-wrap items-center gap-2 min-w-0">{actions}</div>}
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
      {hint && !error && <div className="text-xs text-ink-muted mt-1">{hint}</div>}
      {error && (
        <div className="text-xs text-rose-600 mt-1 flex items-start gap-1">
          <span aria-hidden>⚠</span><span>{error}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Sheet ---------------------------------- */
/** Số hộp thoại đang mở — để khoá/mở khoá cuộn nền đúng lúc khi sheet lồng nhau. */
let openSheets = 0;

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

  // Khoá cuộn nền khi hộp thoại mở, nếu không trên iOS nền vẫn trôi sau lưng sheet.
  // Đếm số sheet đang mở để sheet lồng nhau không mở khoá sớm.
  useEffect(() => {
    if (!open) return undefined;
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      openSheets -= 1;
      if (openSheets <= 0) {
        openSheets = 0;
        document.body.style.overflow = '';
      }
    };
  }, [open]);

  if (!visible) return null;
  return (
    <div
      className={`fixed inset-0 z-[70] flex items-end sm:items-center justify-center transition-colors duration-base ease-out ${show ? 'bg-night/40 backdrop-blur-[2px]' : 'bg-transparent'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className={`bg-white w-full sm:rounded-xl3 rounded-t-xl3 shadow-card-lg overflow-hidden
                    transition-all duration-base ease-out flex flex-col
                    ${wide === 'xl' ? 'sm:max-w-6xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}
                    ${show ? 'translate-y-0 sm:scale-100 opacity-100' : 'translate-y-6 sm:translate-y-0 sm:scale-[.96] opacity-0 sm:opacity-0'}`}
        style={{ maxHeight: 'min(92vh, 100dvh - 24px)' }}>
        <div className="sm:hidden pt-2.5 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        {title && (
          <div className="flex items-center justify-between gap-2 px-5 pt-3.5 pb-2 border-b border-line/70">
            <div className="font-bold text-lg min-w-0 truncate">{title}</div>
            <button className="icon-btn text-ink-muted hover:text-ink hover:bg-zinc-100 text-xl leading-none shrink-0"
              onClick={onClose} aria-label="Đóng">×</button>
          </div>
        )}
        <div className="sheet-body px-5 pb-5 pt-3.5 overflow-y-auto" style={{ paddingBottom: 'calc(20px + var(--safe-bot))' }}>
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
      <p className="text-base text-ink-soft mb-5 leading-relaxed">{message}</p>
      <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:justify-end">
        <button className="btn-line sm:w-auto w-full" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className={`${danger ? 'btn-danger' : 'btn-primary'} sm:w-auto w-full`} onClick={onConfirm} disabled={busy}>
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
    <div className="flex items-center justify-center gap-2.5 mt-4 text-sm">
      <button className="btn-line !px-3.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span className="text-ink-muted tabular-nums px-1">Trang <b className="text-ink">{page}</b>/{pages}</span>
      <button className="btn-line !px-3.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau ›</button>
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
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none">🔍</span>
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
    <div className={`inline-flex rounded-xl2 bg-brand-50 p-1 gap-0.5 overflow-x-auto max-w-full no-scrollbar ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 min-h-[36px] rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-fast ease-out
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
    <div className="card border-rose-200 bg-rose-50/60 p-4 text-center animate-fade-in">
      <div className="text-base text-rose-700 font-medium mb-2">⚠ {error.message || 'Có lỗi xảy ra.'}</div>
      {onRetry && <button className="btn-line" onClick={onRetry}>Thử lại</button>}
    </div>
  );
}
