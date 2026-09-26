/**
 * DeleteOrgSheet.jsx — Xoá TRƯỜNG hoặc LỚP, dùng chung cho cả hai.
 *
 * Hai mức, cố ý tách bạch:
 *   • Ngừng sử dụng — ẩn khỏi xếp lịch/chấm công/điểm danh, dữ liệu lịch sử giữ
 *     nguyên, bật lại lúc nào cũng được. Dùng cho trường/lớp thôi hợp tác.
 *   • Xoá hẳn — xoá khỏi cơ sở dữ liệu, không lấy lại được; mã trường/lớp được
 *     dùng lại ngay sau đó. Mở sẵn khi chưa phát sinh dữ liệu vận hành; đã vận
 *     hành rồi thì chỉ Quản trị viên xoá được, kèm cảnh báo đỏ.
 *
 * Trước khi hỏi, sheet gọi /delete-impact để nói rõ xoá sẽ mất những gì —
 * không bắt người dùng đoán.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

/** 'school' | 'class' → từ ngữ hiển thị và đường dẫn API. */
const KIND = {
  school: { noun: 'trường', base: '/api/schools' },
  class: { noun: 'lớp', base: '/api/classes' },
};

export default function DeleteOrgSheet({ open, kind, item, onClose, onDone }) {
  const auth = useAuth();
  const toast = useToast();
  const { noun, base } = KIND[kind] || KIND.school;
  const [impact, setImpact] = useState(null);
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!open || !item) { setImpact(null); setFailed(null); return; }
    let live = true;
    setImpact(null);
    setFailed(null);
    api.get(`${base}/${item.id}/delete-impact`)
      .then((d) => { if (live) setImpact(d); })
      .catch((e) => { if (live) setFailed(e); });
    return () => { live = false; };
  }, [open, item, base]);

  if (!item) return null;

  const run = async (hard) => {
    setBusy(hard ? 'hard' : 'soft');
    try {
      await api.del(`${base}/${item.id}`, hard ? { query: { hard: 1 } } : undefined);
      toast.ok(hard ? `Đã xoá hẳn ${noun} "${item.name}".` : `Đã ngừng sử dụng ${noun} "${item.name}".`);
      onDone(hard ? 'deleted' : 'disabled');
    } catch (e) {
      toast.err(e?.message || 'Không thực hiện được, vui lòng thử lại.', 9000);
    } finally {
      setBusy('');
    }
  };

  // Quản trị viên xoá hẳn được kể cả khi đã vận hành (để dùng lại mã đã nhập sai).
  const force = auth.can('record.forceDelete');
  const canHard = impact ? (impact.can_hard_delete === true || force) : false;
  const risky = impact?.blockers?.length > 0;
  const lines = (list) => list.map((b) => `${b.count} ${b.label}`).join(' · ');

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={`Xoá ${noun} "${item.name}"`}>
      {failed && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 mb-3.5">
          Không đọc được dữ liệu liên quan. Vẫn ngừng sử dụng được, nhưng chưa xoá hẳn được lúc này.
        </p>
      )}
      {!impact && !failed && (
        <div className="flex items-center gap-2 text-sm text-ink-muted mb-3.5">
          <Spinner className="h-4 w-4" /> Đang kiểm tra dữ liệu liên quan…
        </div>
      )}

      {impact && risky && (
        <div className={`rounded-xl px-3.5 py-2.5 mb-3.5 border
          ${force ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className={`text-sm font-semibold mb-0.5 ${force ? 'text-rose-900' : 'text-amber-900'}`}>
            {noun === 'trường' ? 'Trường' : 'Lớp'} này đã đi vào vận hành
          </div>
          <div className={`text-sm ${force ? 'text-rose-800' : 'text-amber-800'}`}>
            Đang có {lines(impact.blockers)}.{' '}
            {force
              ? 'Là Quản trị viên, bạn vẫn xoá hẳn được — toàn bộ phần lịch sử trên sẽ mất và không lấy lại được. '
                + `Sau khi xoá, mã ${noun} được dùng lại ngay.`
              : 'Xoá hẳn sẽ mất sạch phần lịch sử đó, nên chỉ ngừng sử dụng được (hoặc nhờ Quản trị viên xoá hẳn).'}
          </div>
        </div>
      )}

      {impact && canHard && !risky && impact.cleanup.length > 0 && (
        <div className="rounded-xl bg-canvas border border-line px-3.5 py-2.5 mb-3.5">
          <div className="text-sm text-ink-soft">
            Xoá hẳn sẽ xoá cùng: <b>{lines(impact.cleanup)}</b>.
          </div>
        </div>
      )}
      {impact && canHard && !risky && impact.unlinked?.length > 0 && (
        <div className="text-sm text-ink-muted mb-3.5">
          Giữ lại nhưng bỏ liên kết: {lines(impact.unlinked)}.
        </div>
      )}

      <div className="grid gap-2.5">
        <button className="btn-line !justify-start text-left !py-3" disabled={!!busy}
          onClick={() => run(false)}>
          <span className="grid gap-0.5">
            <span className="font-semibold text-base">
              {busy === 'soft' ? 'Đang xử lý…' : '🚫 Ngừng sử dụng'}
            </span>
            <span className="text-sm text-ink-muted font-normal">
              Ẩn khỏi xếp lịch, chấm công, điểm danh. Giữ nguyên lịch sử, bật lại được.
            </span>
          </span>
        </button>

        <button className="btn-danger !justify-start text-left !py-3 disabled:opacity-40"
          disabled={!!busy || !canHard}
          onClick={() => run(true)}>
          <span className="grid gap-0.5">
            <span className="font-semibold text-base">
              {busy === 'hard' ? 'Đang xoá…' : '🗑 Xoá hẳn'}
            </span>
            <span className="text-sm font-normal opacity-90">
              {!canHard
                ? 'Không dùng được vì đã có dữ liệu vận hành.'
                : risky
                  ? `Xoá cả dữ liệu vận hành kèm theo. Mã ${noun} được dùng lại ngay.`
                  : `Dùng khi nhập sai. Xoá khỏi cơ sở dữ liệu, mã ${noun} được dùng lại ngay.`}
            </span>
          </span>
        </button>
      </div>

      <div className="flex justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={!!busy}>Huỷ</button>
      </div>
    </Sheet>
  );
}
