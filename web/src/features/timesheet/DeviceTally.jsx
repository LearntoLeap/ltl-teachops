/**
 * DeviceTally.jsx — Đếm thiết bị THEO LOẠI khi chấm công vào / ra.
 *
 * Mỗi dòng là một loại (robot UGOT, laptop, tablet…) với ô nhập SỐ LƯỢNG THỰC
 * TẾ và nút −/+. Đầu buổi: dòng lấy sẵn từ danh mục thiết bị của trường, cạnh
 * bên là số chuẩn. Cuối buổi: dòng lấy từ đầu buổi, cạnh bên là số đã đếm lúc
 * đầu buổi — đếm ít hơn thì dòng chuyển đỏ (thiếu).
 *
 * Không tự điền sẵn số lượng: giáo viên phải đếm thật. Nút "Đủ" từng dòng và
 * "Tất cả đủ như chuẩn" giúp xác nhận nhanh khi không có gì lệch.
 */
import { useMemo, useState } from 'react';

const CAT_LABEL = { robotics: 'Robot & bộ kit', computer: 'Máy tính', av: 'Âm thanh – hình ảnh', other: 'Khác' };

/** Dòng khởi tạo từ danh mục trường (đầu buổi) hoặc từ đầu buổi (cuối buổi). */
export function initialRows({ mode, catalog, checkIn, suggestions }) {
  if (mode === 'out' && checkIn?.length) {
    // Biểu tượng không lưu cùng bản ghi — lấy lại theo tên từ danh mục / loại dùng chung.
    const icons = new Map();
    for (const x of [...(suggestions || []), ...(catalog || [])]) {
      if (x.icon) icons.set(String(x.name).trim().toLowerCase(), x.icon);
    }
    return checkIn.map((d) => ({
      name: d.name, unit: d.unit, ref: d.qty, qty: '',
      icon: icons.get(String(d.name).trim().toLowerCase()) || null, catalog_id: d.catalog_id,
    }));
  }
  return (catalog || []).map((c) => ({
    name: c.name, unit: c.unit, ref: c.expected, qty: '', icon: c.icon, catalog_id: c.catalog_id,
  }));
}

/** Chuyển về dạng gửi máy chủ. */
export function toPayload(rows) {
  return rows.map((r) => ({
    name: r.name,
    qty: r.qty === '' ? '' : Number(r.qty),
    unit: r.unit || undefined,
    catalog_id: r.catalog_id || undefined,
    expected: r.ref ?? undefined,
  }));
}

/** Thông báo lỗi nếu còn dòng chưa điền; rỗng nếu hợp lệ. */
export function tallyProblem(rows) {
  if (!rows.length) return 'Vui lòng thêm ít nhất một loại thiết bị và điền số lượng.';
  const blank = rows.filter((r) => r.qty === '' || r.qty === null || Number.isNaN(Number(r.qty)));
  if (blank.length) return `Còn ${blank.length} loại chưa điền số lượng thực tế: ${blank.map((r) => r.name).join(', ')}.`;
  return '';
}

export default function DeviceTally({ mode = 'in', rows, onChange, suggestions = [], error }) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');

  const refLabel = mode === 'out' ? 'đầu buổi' : 'chuẩn';
  const have = useMemo(() => new Set(rows.map((r) => r.name.trim().toLowerCase())), [rows]);
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bump = (i, d) => {
    const cur = rows[i].qty === '' ? (rows[i].ref ?? 0) : Number(rows[i].qty) || 0;
    setRow(i, { qty: String(Math.max(0, cur + d)) });
  };

  const addType = (s) => {
    if (have.has(s.name.trim().toLowerCase())) return;
    onChange([...rows, { name: s.name, unit: s.unit, ref: null, qty: '', icon: s.icon || null, added: true }]);
    setAdding(false);
  };
  const addCustom = () => {
    const name = custom.trim();
    if (!name || have.has(name.toLowerCase())) return;
    onChange([...rows, { name, unit: '', ref: null, qty: '', icon: null, added: true }]);
    setCustom('');
    setAdding(false);
  };

  const allAsRef = () => onChange(rows.map((r) => (r.ref != null ? { ...r, qty: String(r.ref) } : r)));
  const total = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  const filled = rows.filter((r) => r.qty !== '').length;
  const short = rows.filter((r) => r.ref != null && r.qty !== '' && Number(r.qty) < r.ref);

  // Loại dùng chung chưa có trong danh sách, gom theo nhóm.
  const groups = useMemo(() => {
    const g = {};
    for (const s of suggestions) {
      if (have.has(s.name.trim().toLowerCase())) continue;
      (g[s.category || 'other'] ||= []).push(s);
    }
    return g;
  }, [suggestions, have]);

  return (
    <div className="mb-3.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="label !mb-0">
          Thiết bị {mode === 'out' ? 'cuối buổi' : 'đầu buổi'} — số lượng thực tế <span className="text-rose-600">*</span>
        </span>
        {rows.some((r) => r.ref != null) && (
          <button type="button" onClick={allAsRef}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline">
            ✓ Tất cả đủ như {refLabel}
          </button>
        )}
      </div>

      <div className={`rounded-lg border ${error ? 'border-rose-300' : 'border-line'} divide-y divide-line bg-white`}>
        {rows.length === 0 && (
          <div className="px-3 py-3 text-sm text-ink-muted">
            Trường chưa khai báo danh mục thiết bị — bấm “+ Thêm loại thiết bị” để chọn.
          </div>
        )}
        {rows.map((r, i) => {
          const q = r.qty === '' ? null : Number(r.qty);
          const less = r.ref != null && q != null && q < r.ref;
          const more = r.ref != null && q != null && q > r.ref;
          return (
            <div key={r.name} className={`flex items-center gap-2 px-2.5 py-2 ${less ? 'bg-rose-50/70' : ''}`}>
              <span className="text-xl w-6 text-center shrink-0">{r.icon || '📦'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink truncate">{r.name}</div>
                <div className="text-xs text-ink-muted">
                  {r.ref != null ? <>{refLabel}: <b className="text-ink-soft">{r.ref}</b> {r.unit || ''}</> : (r.unit || 'loại thêm')}
                  {less && <span className="text-rose-700 font-semibold"> · thiếu {r.ref - q}</span>}
                  {more && <span className="text-amber-700 font-semibold"> · dư {q - r.ref}</span>}
                </div>
              </div>

              {r.ref != null && q !== r.ref && (
                <button type="button" onClick={() => setRow(i, { qty: String(r.ref) })}
                  className="h-8 px-2 rounded-md text-xs font-semibold text-emerald-700 hover:bg-emerald-50 shrink-0"
                  title={`Đủ ${r.ref}`}>
                  Đủ
                </button>
              )}
              <div className="flex items-center shrink-0">
                <button type="button" onClick={() => bump(i, -1)} aria-label={`Bớt ${r.name}`}
                  className="h-11 w-11 sm:h-9 sm:w-9 rounded-l-md border border-line text-lg text-ink-soft hover:bg-zinc-50 transition-colors duration-fast">−</button>
                <input
                  className={`h-11 sm:h-9 w-14 border-y border-line text-center text-base font-semibold tabular-nums outline-none
                    focus:bg-brand-50 ${less ? 'text-rose-700' : 'text-ink'}`}
                  inputMode="numeric" value={r.qty} placeholder="—"
                  onChange={(e) => setRow(i, { qty: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })}
                  aria-label={`Số lượng ${r.name}`} />
                <button type="button" onClick={() => bump(i, 1)} aria-label={`Thêm ${r.name}`}
                  className="h-11 w-11 sm:h-9 sm:w-9 rounded-r-md border border-line text-lg text-ink-soft hover:bg-zinc-50 transition-colors duration-fast">+</button>
              </div>
              {r.added && (
                <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  aria-label={`Bỏ ${r.name}`}
                  className="h-8 w-7 rounded-md text-ink-muted hover:text-rose-600 hover:bg-rose-50 shrink-0">×</button>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="text-sm font-semibold text-brand-700 hover:text-brand-800">
          {adding ? '− Đóng danh sách' : '+ Thêm loại thiết bị'}
        </button>
        <span className="text-xs text-ink-muted">
          {filled}/{rows.length} loại đã điền · tổng <b className="text-ink-soft">{total}</b>
          {short.length > 0 && <span className="text-rose-700"> · {short.length} loại thiếu</span>}
        </span>
      </div>

      {adding && (
        <div className="mt-2 rounded-lg border border-line bg-zinc-50/60 p-2.5">
          {Object.entries(groups).map(([cat, list]) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {CAT_LABEL[cat] || cat}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => (
                  <button key={s.name} type="button" onClick={() => addType(s)}
                    className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink-soft hover:border-brand-300 hover:text-brand-800">
                    {s.icon} {s.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-1.5 mt-2">
            <input className="input !py-1.5 text-sm" value={custom} onChange={(e) => setCustom(e.target.value)}
              placeholder="Loại khác, VD: Bộ cảm biến" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
            <button type="button" className="btn-line !py-1.5 !px-3" onClick={addCustom}>Thêm</button>
          </div>
        </div>
      )}
    </div>
  );
}
