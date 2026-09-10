/**
 * PhotoInput.jsx — Ô chụp/chọn ảnh minh chứng, tự nén trước khi gửi.
 * Trả về qua onChange danh sách { blob, name, url } (url là objectURL xem trước).
 */
import { useEffect, useRef, useState } from 'react';
import { compressImage, humanSize, pickImages } from '../lib/gps.js';
import { useToast } from './Toast.jsx';

export default function PhotoInput({
  value = [],            // [{blob, name, url}]
  onChange,
  max = 5,
  required = false,
  label = 'Ảnh minh chứng',
  capture = 'environment',  // mở camera sau; null = chỉ chọn từ thư viện
  hint,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const urls = useRef([]);

  // Thu hồi objectURL khi unmount để không rò bộ nhớ.
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const add = async (fromCamera) => {
    if (value.length >= max) {
      toast.info(`Tối đa ${max} ảnh.`);
      return;
    }
    const files = await pickImages({
      multiple: max - value.length > 1 && !fromCamera,
      capture: fromCamera ? capture : null,
    });
    if (!files.length) return;

    setBusy(true);
    try {
      const room = max - value.length;
      const picked = files.slice(0, room);
      const out = [];
      for (const f of picked) {
        if (!f.type.startsWith('image/')) {
          toast.err(`"${f.name}" không phải tệp ảnh.`);
          continue;
        }
        const blob = await compressImage(f);
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        out.push({ blob, name: f.name || 'anh.jpg', url, size: blob.size });
      }
      if (out.length) onChange([...value, ...out]);
      if (files.length > room) toast.info(`Chỉ thêm được ${room} ảnh (tối đa ${max}).`);
    } finally {
      setBusy(false);
    }
  };

  const remove = (idx) => {
    const item = value[idx];
    if (item?.url) URL.revokeObjectURL(item.url);
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="mb-3.5">
      <div className="label">
        {label} {required && <span className="text-rose-500">*</span>}
        {value.length > 0 && <span className="font-normal text-ink-muted"> · {value.length}/{max}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {value.map((img, i) => (
          <div key={img.url} className="relative aspect-square rounded-xl overflow-hidden border border-line bg-brand-50">
            <img src={img.url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-sm grid place-items-center"
              aria-label="Xoá ảnh">×</button>
            <div className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[10px] px-1.5 py-0.5 truncate">
              {humanSize(img.size)}
            </div>
          </div>
        ))}

        {value.length < max && (
          <div className="aspect-square grid grid-rows-2 gap-1.5">
            <button type="button" disabled={busy} onClick={() => add(true)}
              className="rounded-xl border-2 border-dashed border-brand-200 text-brand-600 text-[12px] font-semibold
                         hover:border-brand-400 hover:bg-brand-50 transition disabled:opacity-50">
              📷 Chụp
            </button>
            <button type="button" disabled={busy} onClick={() => add(false)}
              className="rounded-xl border-2 border-dashed border-line text-ink-muted text-[12px] font-semibold
                         hover:border-brand-300 hover:text-brand-600 transition disabled:opacity-50">
              🖼️ Chọn ảnh
            </button>
          </div>
        )}
      </div>

      {hint && <div className="text-[12px] text-ink-muted mt-1.5">{hint}</div>}
      {busy && <div className="text-[12px] text-brand-600 mt-1.5">Đang nén ảnh…</div>}
    </div>
  );
}
