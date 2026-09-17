/**
 * PeriodsSheet.jsx — Cấu hình KHUNG TIẾT DẠY (Quản trị viên).
 *
 * Xếp lịch chỉ chọn "Tiết 3"; giờ vào/ra lấy từ bảng này và được lưu xuống buổi
 * dạy ngay lúc tạo — nên sửa khung tiết về sau KHÔNG làm xê dịch bảng công của
 * các buổi đã xếp. Thêm được tiết 11, 12… cho trường bán trú / ca tối.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { resetPeriods } from '../../lib/periods.js';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

/** Cộng thêm phút vào 'HH:MM'. */
function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function PeriodsSheet({ open, onClose }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [max, setMax] = useState(30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    api.get('/api/periods')
      .then((r) => { setItems(r.items || []); setMax(r.max || 30); })
      .catch((e) => { toast.fromError(e); setItems([]); });
  }, [open, toast]);

  const set = (i, key, value) => setItems((xs) => xs.map((p, j) => (j === i ? { ...p, [key]: value } : p)));

  const addPeriod = () => setItems((xs) => {
    const last = xs[xs.length - 1];
    const no = (last?.no || 0) + 1;
    if (no > max) { toast.err(`Tối đa ${max} tiết.`); return xs; }
    // Tiết mới nối tiếp tiết cuối, cùng độ dài — chỉnh lại tuỳ ý sau.
    const len = last ? Math.max(1, minutesBetween(last.start, last.end)) : 45;
    const start = last ? last.end : '07:00';
    return [...xs, { no, start, end: addMinutes(start, len) }];
  });

  const removeLast = () => setItems((xs) => (xs.length > 1 ? xs.slice(0, -1) : xs));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/api/periods', {
        items: items.map((p) => ({ no: Number(p.no), start: p.start, end: p.end })),
      });
      resetPeriods(r.items);
      toast.ok(`Đã lưu khung ${r.items.length} tiết.`);
      onClose();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={saving ? undefined : onClose} title="Khung tiết dạy" wide>
      <p className="text-[13px] text-ink-soft mb-3">
        Người xếp lịch chỉ chọn số tiết; giờ vào/ra lấy từ bảng này. Sửa khung tiết
        <b> không làm đổi</b> các buổi đã xếp — giờ của chúng đã lưu từ lúc tạo.
      </p>

      {items === null ? (
        <div className="flex items-center gap-2 text-[13.5px] text-ink-muted py-4">
          <Spinner className="h-4 w-4" /> Đang tải khung tiết…
        </div>
      ) : (
        <>
          <div className="grid gap-1.5 max-h-[52vh] overflow-auto pr-0.5">
            {items.map((p, i) => (
              <div key={p.no} className="flex items-center gap-2">
                <span className="w-[68px] shrink-0 text-[13.5px] font-semibold text-brand-800">
                  Tiết {p.no}
                </span>
                <input type="time" className="input !py-2" value={p.start}
                  onChange={(e) => set(i, 'start', e.target.value)} aria-label={`Giờ bắt đầu tiết ${p.no}`} />
                <span className="text-ink-muted">→</span>
                <input type="time" className="input !py-2" value={p.end}
                  onChange={(e) => set(i, 'end', e.target.value)} aria-label={`Giờ kết thúc tiết ${p.no}`} />
                <span className="text-[12px] text-ink-muted w-[64px] shrink-0">
                  {String(p.start) < '12:00' ? 'sáng' : 'chiều'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn-line !py-2" onClick={addPeriod} disabled={items.length >= max}>
              + Thêm tiết {items.length ? (items[items.length - 1].no + 1) : 1}
            </button>
            <button type="button" className="btn-line !py-2" onClick={removeLast} disabled={items.length <= 1}>
              − Bỏ tiết cuối
            </button>
            <span className="text-[12.5px] text-ink-muted self-center">
              {items.length}/{max} tiết
            </span>
          </div>
        </>
      )}

      <div className="flex gap-2.5 justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={saving}>Huỷ</button>
        <button className="btn-primary" onClick={save} disabled={saving || !items?.length}>
          {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu khung tiết'}
        </button>
      </div>
    </Sheet>
  );
}

/** Số phút giữa hai mốc 'HH:MM'. */
function minutesBetween(a, b) {
  const [ah, am] = String(a || '0:0').split(':').map(Number);
  const [bh, bm] = String(b || '0:0').split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}
