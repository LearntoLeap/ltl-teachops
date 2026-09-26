/**
 * PeriodSetsTab.jsx — Giờ học TỪNG TIẾT theo MÙA của một trường.
 *
 * Mùa hè, mùa đông giờ vào học khác nhau ⇒ mỗi trường có nhiều bộ giờ, mỗi bộ
 * áp dụng trong một khoảng ngày. Xếp lịch vào ngày nào thì tiết lấy giờ theo
 * bộ đang hiệu lực ngày đó. Quản trị viên và Phòng chuyên môn quản lý.
 *
 * Giờ của buổi dạy được chốt lúc xếp lịch, nên sửa bộ giờ không làm xê dịch
 * các buổi đã có.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmtDate } from '../../lib/format.js';
import { Badge, EmptyState, ErrorBox, Field, PageLoading, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Cộng phút vào 'HH:MM'. */
function addMin(hhmm, m) {
  const [h, mm] = String(hhmm || '07:00').split(':').map(Number);
  const t = (h * 60 + mm + m + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Hai mẫu hay dùng — bấm là có sẵn, chỉnh lại cho khớp trường. */
const PRESETS = {
  summer: [
    ['07:00', '07:45'], ['07:50', '08:35'], ['08:50', '09:35'], ['09:40', '10:25'], ['10:30', '11:15'],
    ['13:30', '14:15'], ['14:20', '15:05'], ['15:20', '16:05'], ['16:10', '16:55'], ['17:00', '17:45'],
  ],
  winter: [
    ['07:15', '08:00'], ['08:05', '08:50'], ['09:05', '09:50'], ['09:55', '10:40'], ['10:45', '11:30'],
    ['13:15', '14:00'], ['14:05', '14:50'], ['15:05', '15:50'], ['15:55', '16:40'], ['16:45', '17:30'],
  ],
};
const presetItems = (key) => PRESETS[key].map(([start, end], i) => ({ no: i + 1, start, end }));

/* ------------------------------ Sheet sửa bộ giờ --------------------------- */
function SetSheet({ schoolId, set, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !set?.id;
  const [name, setName] = useState(set?.name || '');
  const [from, setFrom] = useState(set ? String(set.valid_from).slice(0, 10) : '');
  const [to, setTo] = useState(set ? String(set.valid_to).slice(0, 10) : '');
  const [items, setItems] = useState(set?.items?.length ? set.items : presetItems('summer'));
  const [busy, setBusy] = useState(false);

  const setCell = (i, k, v) => setItems((xs) => xs.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const addRow = () => setItems((xs) => {
    const last = xs[xs.length - 1];
    const start = last ? last.end : '07:00';
    return [...xs, { no: (last?.no || 0) + 1, start, end: addMin(start, 45) }];
  });

  const save = async () => {
    if (!name.trim()) { toast.err('Vui lòng đặt tên bộ giờ, VD "Mùa đông 2026–27".'); return; }
    if (!from || !to) { toast.err('Vui lòng chọn khoảng ngày áp dụng.'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), valid_from: from, valid_to: to, items };
      if (isNew) await api.post(`/api/schools/${schoolId}/period-sets`, body);
      else await api.put(`/api/period-sets/${set.id}`, body);
      toast.ok(isNew ? 'Đã thêm bộ giờ học.' : 'Đã lưu bộ giờ học.');
      onSaved();
    } catch (e) {
      toast.err(e?.message || 'Không lưu được.', 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={busy ? undefined : onClose} title={isNew ? 'Thêm bộ giờ học' : `Sửa "${set.name}"`} wide>
      <div className="grid sm:grid-cols-[1fr_150px_150px] gap-x-3">
        <Field label="Tên bộ giờ" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="VD: Mùa đông 2026–27" />
        </Field>
        <Field label="Từ ngày" required>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Đến ngày" required>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {isNew && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <span className="text-ink-muted">Điền nhanh theo mẫu:</span>
          <button type="button" className="btn-line !py-1 !px-2.5 !text-sm"
            onClick={() => setItems(presetItems('summer'))}>☀️ Mùa hè</button>
          <button type="button" className="btn-line !py-1 !px-2.5 !text-sm"
            onClick={() => setItems(presetItems('winter'))}>❄️ Mùa đông</button>
        </div>
      )}

      <div className="rounded-lg border border-line overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr><th className="th !w-[80px]">Tiết</th><th className="th">Vào</th><th className="th">Ra</th><th className="th">Buổi</th></tr>
          </thead>
          <tbody>
            {items.map((p, i) => (
              <tr key={p.no}>
                <td className="td font-semibold text-brand-800">Tiết {p.no}</td>
                <td className="td !py-1.5">
                  <input type="time" className="input !py-1.5" value={p.start}
                    onChange={(e) => setCell(i, 'start', e.target.value)} aria-label={`Giờ vào tiết ${p.no}`} />
                </td>
                <td className="td !py-1.5">
                  <input type="time" className="input !py-1.5" value={p.end}
                    onChange={(e) => setCell(i, 'end', e.target.value)} aria-label={`Giờ ra tiết ${p.no}`} />
                </td>
                <td className="td text-ink-muted text-sm">{Number(p.no) <= 5 ? 'Sáng' : 'Chiều'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-2.5">
        <button type="button" className="btn-line !py-1.5" onClick={addRow} disabled={items.length >= 30}>
          + Thêm tiết {items.length + 1}
        </button>
        <button type="button" className="btn-line !py-1.5"
          onClick={() => setItems((xs) => (xs.length > 1 ? xs.slice(0, -1) : xs))} disabled={items.length <= 1}>
          − Bỏ tiết cuối
        </button>
      </div>

      <div className="form-actions flex gap-2.5 justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Lưu bộ giờ'}
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------------- Tab chính -------------------------------- */
export default function PeriodSetsTab({ schoolId, canManage }) {
  const toast = useToast();
  const [sets, setSets] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // {} = thêm mới · set = sửa

  const load = useCallback(async () => {
    setError(null);
    try { setSets((await api.get(`/api/schools/${schoolId}/period-sets`)).items || []); }
    catch (e) { setError(e); }
  }, [schoolId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (set) => {
    if (!window.confirm(`Xoá bộ giờ "${set.name}"? Các buổi đã xếp giữ nguyên giờ.`)) return;
    try {
      await api.del(`/api/period-sets/${set.id}`);
      toast.ok('Đã xoá bộ giờ học.');
      load();
    } catch (e) { toast.fromError(e); }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!sets) return <PageLoading />;

  const now = today();
  const activeId = sets.find((x) => x.is_active && String(x.valid_from).slice(0, 10) <= now
    && String(x.valid_to).slice(0, 10) >= now)?.id;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-ink-muted max-w-[560px]">
          Giờ vào học từng tiết theo mùa. Xếp lịch ngày nào thì tiết lấy giờ theo bộ đang hiệu lực
          ngày đó; không có bộ nào thì dùng khung chung.
        </p>
        {canManage && <button className="btn-primary" onClick={() => setEditing({})}>+ Thêm bộ giờ</button>}
      </div>

      {sets.length === 0 ? (
        <EmptyState icon="⏱" title="Trường chưa có bộ giờ theo mùa"
          hint="Thêm bộ “Mùa hè” và “Mùa đông” để giờ tiết khớp thực tế của trường."
          action={canManage && <button className="btn-primary" onClick={() => setEditing({})}>+ Thêm bộ giờ</button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sets.map((st) => (
            <div key={st.id} className={`card p-4 ${st.id === activeId ? 'ring-2 ring-brand-500/40' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-lg truncate">{st.name}</div>
                  <div className="text-sm text-ink-muted">
                    {fmtDate(st.valid_from)} → {fmtDate(st.valid_to)} · {st.items.length} tiết
                  </div>
                </div>
                {st.id === activeId
                  ? <Badge tone="approved">Đang áp dụng</Badge>
                  : String(st.valid_from).slice(0, 10) > now ? <Badge tone="new">Sắp tới</Badge>
                  : <Badge tone="low">Đã qua</Badge>}
              </div>
              <div className="flex flex-wrap gap-1 mt-2.5">
                {st.items.map((p) => (
                  <span key={p.no} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-ink-soft tabular-nums">
                    <b className="text-brand-700">{p.no}</b> {p.start}
                  </span>
                ))}
              </div>
              {canManage && (
                <div className="flex gap-2 mt-3">
                  <button className="btn-line !py-1.5 flex-1" onClick={() => setEditing(st)}>✏️ Sửa</button>
                  <button className="btn-line !py-1.5 !text-rose-700 hover:!bg-rose-50" onClick={() => remove(st)}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SetSheet key={editing.id || 'new'} schoolId={schoolId} set={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
