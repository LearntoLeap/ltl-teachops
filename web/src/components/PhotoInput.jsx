/**
 * PhotoInput.jsx — Ô chụp/chọn ảnh minh chứng (tự nén trước khi gửi), tuỳ chọn cả VIDEO.
 * Trả về qua onChange danh sách { blob, name, url, size, kind: 'image' | 'video' }.
 *
 * allowVideo: thêm nút "Quay video" và cho chọn video từ máy — video giữ nguyên
 * (không nén được trên trình duyệt), chặn nếu vượt maxVideoMb.
 */
import { useEffect, useRef, useState } from 'react';
import { compressImage, humanSize, pickImages } from '../lib/gps.js';
import { useToast } from './Toast.jsx';
import { MAX_FIELD_VIDEO_MB } from '../lib/limits.js';

export default function PhotoInput({
  value = [],            // [{blob, name, url, size, kind}]
  onChange,
  max = 5,
  required = false,
  label = 'Ảnh minh chứng',
  capture = 'environment',  // mở camera sau; null = chỉ chọn từ thư viện
  hint,
  allowVideo = false,
  maxVideoMb = MAX_FIELD_VIDEO_MB,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const urls = useRef([]);

  // Thu hồi objectURL khi unmount để không rò bộ nhớ.
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  /** mode: 'photo' (chụp ảnh) · 'video' (quay video) · 'pick' (chọn từ máy). */
  const add = async (mode) => {
    if (value.length >= max) {
      toast.info(`Tối đa ${max} tệp.`);
      return;
    }
    const files = await pickImages({
      multiple: mode === 'pick' && max - value.length > 1,
      capture: mode === 'pick' ? null : capture,
      accept: mode === 'video' ? 'video/*' : mode === 'pick' && allowVideo ? 'image/*,video/*' : 'image/*',
    });
    if (!files.length) return;

    setBusy(true);
    try {
      const room = max - value.length;
      const picked = files.slice(0, room);
      const out = [];
      for (const f of picked) {
        const isVid = f.type.startsWith('video/');
        if (isVid && !allowVideo) {
          toast.err(`"${f.name}" là video — mục này chỉ nhận ảnh.`);
          continue;
        }
        if (!isVid && !f.type.startsWith('image/')) {
          toast.err(`"${f.name}" không phải ảnh${allowVideo ? ' hoặc video' : ''}.`);
          continue;
        }
        if (isVid && f.size > maxVideoMb * 1024 * 1024) {
          toast.err(`Video "${f.name}" nặng ${humanSize(f.size)} — tối đa ${maxVideoMb} MB, hãy quay ngắn hơn.`, 6000);
          continue;
        }
        const blob = isVid ? f : await compressImage(f);
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        out.push({
          blob,
          name: f.name || (isVid ? 'video.mp4' : 'anh.jpg'),
          url,
          size: blob.size,
          kind: isVid ? 'video' : 'image',
        });
      }
      if (out.length) onChange([...value, ...out]);
      if (files.length > room) toast.info(`Chỉ thêm được ${room} tệp (tối đa ${max}).`);
    } finally {
      setBusy(false);
    }
  };

  const remove = (idx) => {
    const item = value[idx];
    if (item?.url) URL.revokeObjectURL(item.url);
    onChange(value.filter((_, i) => i !== idx));
  };

  const btn = 'rounded-xl border-2 border-dashed text-[12px] font-semibold transition disabled:opacity-50';

  return (
    <div className="mb-3.5">
      <div className="label">
        {label} {required && <span className="text-rose-500">*</span>}
        {value.length > 0 && <span className="font-normal text-ink-muted"> · {value.length}/{max}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {value.map((item, i) => (
          <div key={item.url} className="relative aspect-square rounded-xl overflow-hidden border border-line bg-brand-50">
            {item.kind === 'video' ? (
              <>
                <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover bg-black" />
                <span className="absolute inset-0 grid place-items-center pointer-events-none">
                  <span className="h-9 w-9 rounded-full bg-white/90 text-brand-700 grid place-items-center text-[15px] pl-0.5">▶</span>
                </span>
              </>
            ) : (
              <img src={item.url} alt="" className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-sm grid place-items-center"
              aria-label={item.kind === 'video' ? 'Xoá video' : 'Xoá ảnh'}>×</button>
            <div className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[10px] px-1.5 py-0.5 truncate">
              {item.kind === 'video' ? '🎥 ' : ''}{humanSize(item.size)}
            </div>
          </div>
        ))}

        {value.length < max && (
          <div className={`aspect-square grid gap-1.5 ${allowVideo ? 'grid-rows-3' : 'grid-rows-2'}`}>
            <button type="button" disabled={busy} onClick={() => add('photo')}
              className={`${btn} border-brand-200 text-brand-600 hover:border-brand-400 hover:bg-brand-50`}>
              📷 Chụp{allowVideo ? ' ảnh' : ''}
            </button>
            {allowVideo && (
              <button type="button" disabled={busy} onClick={() => add('video')}
                className={`${btn} border-brand-200 text-brand-600 hover:border-brand-400 hover:bg-brand-50`}>
                🎥 Quay video
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => add('pick')}
              className={`${btn} border-line text-ink-muted hover:border-brand-300 hover:text-brand-600`}>
              🖼️ Chọn {allowVideo ? 'từ máy' : 'ảnh'}
            </button>
          </div>
        )}
      </div>

      {hint && <div className="text-[12px] text-ink-muted mt-1.5">{hint}</div>}
      {allowVideo && (
        <div className="text-[11.5px] text-ink-muted mt-1">
          🎥 Video tối đa {maxVideoMb} MB (khoảng 1–2 phút) — tự lưu về Google Drive của công ty.
        </div>
      )}
      {busy && <div className="text-[12px] text-brand-600 mt-1.5">Đang xử lý tệp…</div>}
    </div>
  );
}
