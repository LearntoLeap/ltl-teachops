/**
 * DeleteMaterialSheet.jsx — Xác nhận xoá học liệu (một hoặc nhiều mục cùng lúc).
 *
 * Hai mức:
 *   - Gỡ khỏi kho (mặc định): tài liệu biến mất khỏi danh sách, tệp vẫn còn — nhờ Quản trị
 *     viên khôi phục được nếu bấm nhầm.
 *   - Xoá hẳn (Admin / Phòng chuyên môn): xoá cả tệp trên máy chủ và đưa bản trên Google
 *     Drive vào thùng rác — dùng khi đăng nhầm, giải phóng dung lượng luôn.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

export default function DeleteMaterialSheet({ open, onClose, items = [], canHardDelete, onDone }) {
  const toast = useToast();
  const [hard, setHard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => { if (open) { setHard(false); setDone(0); } }, [open]);

  const many = items.length > 1;

  const submit = async () => {
    setBusy(true);
    setDone(0);
    const failed = [];
    const okIds = [];
    for (const it of items) {
      try {
        await api.del(`/api/materials/${it.id}${hard ? '?hard=1' : ''}`);
        okIds.push(it.id);
      } catch (e) {
        failed.push(`${it.title}: ${e.message}`);
      }
      setDone((d) => d + 1);
    }
    setBusy(false);

    if (okIds.length) {
      toast.ok(hard
        ? `Đã xoá hẳn ${okIds.length} tài liệu (kèm tệp).`
        : `Đã gỡ ${okIds.length} tài liệu khỏi kho.`);
    }
    if (failed.length) toast.err(`${failed.length} tài liệu không xoá được — ${failed[0]}`, 8000);
    onDone(okIds);
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose}
      title={many ? `Xoá ${items.length} tài liệu?` : 'Xoá tài liệu?'}>
      {!many && items[0] && (
        <div className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3 text-sm font-semibold text-ink">
          {items[0].title}
        </div>
      )}
      {many && (
        <ul className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3 text-sm text-ink-soft max-h-40 overflow-y-auto">
          {items.slice(0, 8).map((it) => <li key={it.id} className="truncate">• {it.title}</li>)}
          {items.length > 8 && <li className="text-ink-muted">… và {items.length - 8} tài liệu khác</li>}
        </ul>
      )}

      <p className="text-sm text-ink-soft mb-3">
        {hard
          ? 'Tài liệu và tệp đính kèm sẽ bị xoá khỏi máy chủ; bản trên Google Drive được đưa vào thùng rác (Drive giữ khoảng 30 ngày).'
          : 'Tài liệu được gỡ khỏi kho — không ai thấy nữa nhưng tệp vẫn còn, nhờ Quản trị viên khôi phục được nếu bấm nhầm.'}
      </p>

      {canHardDelete && (
        <label className="flex items-start gap-2.5 mb-4 cursor-pointer rounded-xl border border-line px-3.5 py-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-600" checked={hard} disabled={busy}
            onChange={(e) => setHard(e.target.checked)} />
          <span className="text-sm">
            <b className="text-rose-700">Xoá hẳn cả tệp</b> — dùng khi đăng nhầm và muốn giải phóng
            dung lượng máy chủ ngay.
          </span>
        </label>
      )}

      <div className="flex gap-2.5 justify-end">
        <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="button" className="btn-danger" onClick={submit} disabled={busy || !items.length}>
          {busy
            ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang xoá {done}/{items.length}…</>
            : hard ? 'Xoá hẳn' : 'Gỡ khỏi kho'}
        </button>
      </div>
    </Sheet>
  );
}
