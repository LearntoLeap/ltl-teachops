/**
 * TietActions.jsx — Thao tác trên MỘT tiết dạy, đặt trong sheet chi tiết.
 *
 *  • Đổi trạng thái (Phòng chuyên môn / Quản trị viên), luôn kèm lý do:
 *      Huỷ lịch — kế hoạch thay đổi từ trước (nghỉ lễ, trường bận…)
 *      Đã bỏ    — đến giờ nhưng tiết không diễn ra
 *      Xoá hẳn  — nhập nhầm; chỉ được khi tiết chưa điểm danh
 *    Tiết đã huỷ / đã bỏ vẫn HIỆN trong lịch và báo cáo, kèm lý do — dễ nắm.
 *
 *  • Giao trợ giảng: mỗi tiết có thể một trợ giảng khác nhau. Giáo viên của
 *    tiết tự giao; người được giao sẽ check-in và điểm danh tiết đó.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const OPTIONS = [
  {
    value: 'cancelled',
    icon: '🚫',
    label: 'Huỷ lịch',
    hint: 'Kế hoạch thay đổi từ trước — nghỉ lễ, trường có việc, đổi lịch. Tiết vẫn hiện, gạch ngang.',
    tone: 'border-amber-300 bg-amber-50',
  },
  {
    value: 'skipped',
    icon: '⏭️',
    label: 'Đã bỏ',
    hint: 'Đến giờ nhưng tiết không diễn ra — giáo viên vắng, lớp đi ngoại khoá đột xuất.',
    tone: 'border-orange-300 bg-orange-50',
  },
  {
    value: 'delete',
    icon: '🗑️',
    label: 'Xoá hẳn',
    hint: 'Nhập nhầm, xoá khỏi hệ thống. Vết vẫn còn trong nhật ký.',
    tone: 'border-rose-300 bg-rose-50',
  },
];

/* --------------------------- Sheet đổi trạng thái -------------------------- */
function StatusSheet({ open, tiet, onClose, onDone }) {
  const auth = useAuth();
  const toast = useToast();
  const [choice, setChoice] = useState('cancelled');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const closedTiet = tiet?.status === 'cancelled' || tiet?.status === 'skipped';
  useEffect(() => {
    if (open) { setChoice(closedTiet ? 'delete' : 'cancelled'); setReason(''); }
  }, [open, closedTiet]);

  const submit = async () => {
    if (choice !== 'delete' && reason.trim().length < 5) {
      toast.err('Vui lòng ghi lý do (ít nhất 5 ký tự).');
      return;
    }
    setBusy(true);
    try {
      if (choice === 'delete') {
        await api.del(`/api/schedules/${tiet.id}`, { query: { reason: reason.trim() || undefined } });
        toast.ok('Đã xoá hẳn tiết dạy.');
        onDone('deleted');
      } else {
        await api.post(`/api/schedules/${tiet.id}/status`, { status: choice, reason: reason.trim() });
        toast.ok(choice === 'cancelled' ? 'Đã huỷ lịch tiết dạy.' : 'Đã đánh dấu tiết là đã bỏ.');
        onDone(choice);
      }
    } catch (e) {
      toast.err(e?.message || 'Không thực hiện được.', 8000);
    } finally {
      setBusy(false);
    }
  };

  const picked = OPTIONS.find((o) => o.value === choice);

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Đổi trạng thái tiết dạy">
      <div className="grid gap-2 mb-3">
        {OPTIONS.map((o) => {
          const on = o.value === choice;
          return (
            <button key={o.value} type="button" onClick={() => setChoice(o.value)}
              className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors duration-150
                ${on ? o.tone : 'border-line bg-white hover:bg-zinc-50'}`}>
              <div className="flex items-center gap-2 font-semibold text-base">
                <span className={`h-4 w-4 rounded-full border-2 grid place-items-center
                  ${on ? 'border-brand-600' : 'border-zinc-300'}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </span>
                <span>{o.icon} {o.label}</span>
              </div>
              <div className="text-sm text-ink-muted mt-0.5 pl-6">
                {o.hint}
                {o.value === 'delete' && !auth.can('record.forceDelete')
                  && ' Tiết đã điểm danh thì chỉ Quản trị viên xoá được.'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Tiết đã điểm danh mà Quản trị viên chọn xoá: nói rõ mất những gì. */}
      {choice === 'delete' && (tiet?.has_attendance ?? tiet?.attendance_done) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-sm px-3 py-2.5 mb-3">
          ⚠ Tiết này <b>đã điểm danh</b>. Xoá hẳn sẽ mất luôn sĩ số, ảnh lớp và bản chấm công
          gắn với tiết — không khôi phục được. Chỉ nên dùng khi nhập nhầm.
        </div>
      )}

      <Field label={choice === 'delete' ? 'Ghi chú (tuỳ chọn)' : 'Lý do'} required={choice !== 'delete'}>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={choice === 'cancelled' ? 'VD: Trường tổ chức thi học kỳ'
            : choice === 'skipped' ? 'VD: Lớp đi ngoại khoá đột xuất'
            : 'VD: Nhập trùng tiết'} />
      </Field>

      <div className="form-actions flex gap-2.5 justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={busy}>Đóng</button>
        <button className={choice === 'delete' ? 'btn-danger' : 'btn-primary'} onClick={submit} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : `${picked.icon} ${picked.label}`}
        </button>
      </div>
    </Sheet>
  );
}

/* ----------------------------- Giao trợ giảng ------------------------------ */
function AssistantPicker({ tiet, onDone }) {
  const toast = useToast();
  const [opts, setOpts] = useState(null);
  const [value, setValue] = useState(tiet.assistant_id || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/api/schedules/${tiet.id}/assistant-options`)
      .then((r) => { if (live) setOpts(r.items || []); })
      .catch(() => { if (live) setOpts([]); });
    return () => { live = false; };
  }, [tiet.id]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/schedules/${tiet.id}/assistant`, { assistant_id: value || null });
      toast.ok(value ? 'Đã giao trợ giảng cho tiết này.' : 'Đã bỏ giao trợ giảng.');
      onDone();
    } catch (e) {
      toast.err(e?.message || 'Không giao được.', 8000);
    } finally {
      setBusy(false);
    }
  };

  const here = (opts || []).filter((u) => u.at_school);
  const other = (opts || []).filter((u) => !u.at_school);
  const changed = (value || '') !== (tiet.assistant_id || '');

  return (
    <div className="rounded-lg border border-line bg-zinc-50/60 px-3 py-2.5 mb-3">
      <div className="text-sm font-semibold text-ink-soft mb-1.5">
        👥 Trợ giảng check-in &amp; điểm danh tiết này
      </div>
      <div className="flex gap-2">
        <select className="input !py-1.5" value={value} disabled={!opts || busy}
          onChange={(e) => setValue(e.target.value)}>
          <option value="">{opts ? '— Không giao —' : 'Đang tải…'}</option>
          {here.length > 0 && (
            <optgroup label="Đang ở trường này">
              {here.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </optgroup>
          )}
          {other.length > 0 && (
            <optgroup label={here.length ? 'Trợ giảng khác' : 'Tất cả trợ giảng'}>
              {other.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </optgroup>
          )}
        </select>
        <button className="btn-primary !px-3 !py-1.5 shrink-0" onClick={save} disabled={!changed || busy}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Giao'}
        </button>
      </div>
      <div className="text-xs text-ink-muted mt-1">
        Người được giao sẽ nhận thông báo và thấy tiết này ở mục Điểm danh.
      </div>
    </div>
  );
}

/* -------------------------------- Khối chính ------------------------------- */
export default function TietActions({ tiet, canManage, isOwnTeacher, onChanged, onEdit }) {
  const toast = useToast();
  const [statusOpen, setStatusOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const closed = tiet.status === 'cancelled' || tiet.status === 'skipped';
  const taught = !!(tiet.has_attendance ?? tiet.attendance_done);

  const restore = async () => {
    setRestoring(true);
    try {
      await api.post(`/api/schedules/${tiet.id}/status`, { status: 'scheduled' });
      toast.ok('Đã khôi phục tiết về theo lịch.');
      onChanged('scheduled');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {closed && tiet.status_reason && (
        <div className={`rounded-lg border px-3 py-2 mb-3 text-sm
          ${tiet.status === 'cancelled' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
          <b>{tiet.status === 'cancelled' ? '🚫 Huỷ lịch' : '⏭️ Đã bỏ'}</b> — {tiet.status_reason}
        </div>
      )}

      {!closed && !taught && (isOwnTeacher || canManage) && (
        <AssistantPicker tiet={tiet} onDone={() => onChanged('assigned')} />
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {!closed && (
            <button className="btn-line flex-1" onClick={onEdit}>✏️ Sửa</button>
          )}
          {closed && (
            <button className="btn-primary flex-1" onClick={restore} disabled={restoring}>
              {restoring ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '↩️ Khôi phục về theo lịch'}
            </button>
          )}
          <button className="btn-line flex-1 !text-rose-700 hover:!bg-rose-50 hover:!border-rose-200"
            onClick={() => setStatusOpen(true)}>
            {closed ? '🗑 Xoá hẳn tiết' : '⋯ Huỷ / bỏ / xoá tiết'}
          </button>
        </div>
      )}

      <StatusSheet
        open={statusOpen}
        tiet={tiet}
        onClose={() => setStatusOpen(false)}
        onDone={(what) => { setStatusOpen(false); onChanged(what); }}
      />
    </>
  );
}
