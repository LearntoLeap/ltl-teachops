/**
 * MaterialPreview.jsx — Xem trước tài liệu ngay trong app, không cần tải về.
 *
 * PDF · ảnh · video · văn bản: xem thẳng. Word/PowerPoint/Excel thì trình duyệt không mở
 * được nên hiện nút tải về (mở bằng máy). Bài viết không kèm tệp thì hiện luôn nội dung.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { fmtSize, LABEL } from '../../lib/format.js';
import { Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

/** Loại nội dung xem trước được, suy từ mime hoặc đuôi tệp. */
export function previewKind(file) {
  if (!file) return 'none';
  const mime = String(file.mime || '').toLowerCase();
  const ext = String(file.file_name || '').split('.').pop().toLowerCase();
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext)) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || ext === 'txt') return 'text';
  return 'office';
}

const OFFICE_NAME = {
  doc: 'Word', docx: 'Word', ppt: 'PowerPoint', pptx: 'PowerPoint',
  xls: 'Excel', xlsx: 'Excel', zip: 'tệp nén',
};

export default function MaterialPreview({ open, material, onClose }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  if (!material) return null;

  const v = material.latest_version;
  const kind = v?.file_id ? previewKind(v) : (material.body ? 'body' : 'none');
  const src = v?.file_id ? fileUrl(v.file_id) : '';
  const ext = String(v?.file_name || '').split('.').pop().toLowerCase();

  const download = async () => {
    if (!v?.file_id) return;
    setDownloading(true);
    try {
      await api.download(`/api/files/${v.file_id}`, { download: 1 }, v.file_name || material.title);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDownloading(false);
    }
  };

  const lesson = [
    material.lesson_no ? `Tiết ${material.lesson_no}` : null,
    material.lesson_title,
    material.curriculum,
  ].filter(Boolean).join(' — ');

  return (
    <Sheet open={open} onClose={onClose} wide="xl" title={material.title}>
      <div className="text-[12.5px] text-ink-muted mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {material.type_name && <span>{material.type_icon} {material.type_name}</span>}
        {material.grade && <span>Khối {material.grade}</span>}
        {material.level && <span>{LABEL.level[material.level]}</span>}
        {material.subject && <span>{material.subject}</span>}
        {lesson && <span className="text-brand-700 font-medium">📖 {lesson}</span>}
      </div>

      <div className="rounded-xl border border-line bg-canvas overflow-hidden">
        {kind === 'pdf' && (
          <iframe title={material.title} src={src} className="w-full h-[68vh] bg-white" />
        )}
        {kind === 'image' && (
          <div className="max-h-[68vh] overflow-auto grid place-items-center bg-white">
            <img src={src} alt={material.title} className="max-w-full" />
          </div>
        )}
        {kind === 'video' && (
          <video src={src} controls playsInline className="w-full max-h-[68vh] bg-black" />
        )}
        {kind === 'text' && (
          <iframe title={material.title} src={src} className="w-full h-[60vh] bg-white" />
        )}
        {kind === 'body' && (
          <div className="p-4 max-h-[68vh] overflow-auto text-[14px] leading-relaxed whitespace-pre-line">
            {material.body}
          </div>
        )}
        {kind === 'office' && (
          <div className="p-8 text-center">
            <div className="text-[40px] mb-2">📄</div>
            <div className="font-semibold text-[15px] text-ink mb-1">
              Tệp {OFFICE_NAME[ext] || ext.toUpperCase()} không xem trước được trên trình duyệt
            </div>
            <div className="text-[13px] text-ink-muted mb-4">
              Tải về để mở bằng {OFFICE_NAME[ext] || 'ứng dụng tương ứng'} trên máy.
            </div>
            <button className="btn-primary" onClick={download} disabled={downloading}>
              {downloading ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '⬇ Tải về'}
            </button>
          </div>
        )}
        {kind === 'none' && (
          <div className="p-8 text-center text-[13.5px] text-ink-muted">Tài liệu này chưa có tệp đính kèm.</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mt-3">
        <Link to={`/hoc-lieu/${material.id}`} className="btn-line !py-2">Mở trang chi tiết</Link>
        {v?.file_id && kind !== 'office' && (
          <button className="btn-line !py-2" onClick={download} disabled={downloading}>
            {downloading ? <Spinner className="h-4 w-4" /> : '⬇ Tải về'}
          </button>
        )}
        {v?.file_name && (
          <span className="text-[12px] text-ink-muted truncate">
            {v.file_name}{fmtSize(v.size) ? ` · ${fmtSize(v.size)}` : ''}
          </span>
        )}
        <button className="btn-line !py-2 ml-auto" onClick={onClose}>Đóng</button>
      </div>
    </Sheet>
  );
}
