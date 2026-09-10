/**
 * OutboxScreen.jsx — Màn hình "Chờ đồng bộ" (/cho-dong-bo).
 *
 * Hiển thị hàng đợi thao tác lưu cục bộ khi mất mạng (chấm công, điểm danh):
 *   - Trạng thái mạng + nút "Đồng bộ ngay" (flush).
 *   - Danh sách theo trạng thái: chờ gửi / đang gửi / lỗi (gửi lại, xoá) / đã gửi.
 */
import { useCallback, useEffect, useState } from 'react';
import { listAll, onOutboxChange, flush, retry, remove, isOnline } from '../../lib/offline.js';
import { fmtDateTime } from '../../lib/format.js';
import { Badge, Spinner, PageLoading, EmptyState, PageHeader, ConfirmSheet } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

/** Biểu tượng theo loại thao tác trong hàng đợi. */
const KIND_ICON = { checkin: '📍', checkout: '🏁', attendance: '📋' };

/** Nhãn trạng thái của một mục. */
function StatusBadge({ status }) {
  if (status === 'pending') return <Badge tone="pending">Chờ gửi</Badge>;
  if (status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700">
        <Spinner className="h-3.5 w-3.5" /> Đang gửi…
      </span>
    );
  }
  if (status === 'failed') return <Badge tone="rejected">Gửi lỗi</Badge>;
  return <Badge tone="approved">Đã gửi</Badge>;
}

/** Một dòng trong hàng đợi. */
function OutboxItem({ item, onRetry, onAskDelete }) {
  const done = item.status === 'done';
  return (
    <div className={`card p-4 ${done ? 'opacity-55' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-[22px] leading-none mt-0.5">{KIND_ICON[item.kind] || '📦'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[14px] text-ink">{item.label}</span>
            <StatusBadge status={item.status} />
          </div>
          <div className="text-[12px] text-ink-muted mt-1">
            Tạo lúc {fmtDateTime(item.createdAt)}
            {item.attempts > 1 && <> · Đã thử {item.attempts} lần</>}
          </div>
          {done && item.sentAt && (
            <div className="text-[12px] text-emerald-700 mt-0.5">
              Đã gửi lúc {fmtDateTime(item.sentAt)}
            </div>
          )}
          {item.status === 'failed' && (
            <>
              {item.lastError && (
                <div className="text-[12.5px] text-rose-600 mt-1.5">⚠ {item.lastError}</div>
              )}
              <div className="flex gap-2 mt-2.5">
                <button className="btn-line !px-3 !py-1.5" onClick={() => onRetry(item.id)}>
                  🔄 Gửi lại
                </button>
                <button className="btn-danger !px-3 !py-1.5" onClick={() => onAskDelete(item)}>
                  🗑 Xoá
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OutboxScreen() {
  const toast = useToast();
  const [items, setItems] = useState(null);          // null = đang tải lần đầu
  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [askDelete, setAskDelete] = useState(null);  // mục đang chờ xác nhận xoá
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems(await listAll());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    reload();
    // onOutboxChange chỉ trả các mục chưa gửi ⇒ nạp lại toàn bộ để thấy cả mục "done".
    const off = onOutboxChange(() => { reload(); });
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      off();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [reload]);

  /** Bấm "Đồng bộ ngay". */
  const doFlush = async () => {
    setSyncing(true);
    try {
      const { sent, failed } = await flush();
      const msg = `${sent} đã gửi, ${failed} lỗi`;
      if (failed > 0) toast.err(msg);
      else toast.ok(msg);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSyncing(false);
      reload();
    }
  };

  /** Đưa mục lỗi về hàng chờ và gửi lại. */
  const doRetry = async (id) => {
    try {
      await retry(id);
      toast.info('Đã đưa vào hàng chờ, đang gửi lại…');
    } catch (e) {
      toast.fromError(e);
    }
  };

  /** Xoá hẳn một mục lỗi (sau khi xác nhận). */
  const doDelete = async () => {
    if (!askDelete) return;
    setDeleting(true);
    try {
      await remove(askDelete.id);
      toast.ok('Đã xoá khỏi hàng đợi.');
      setAskDelete(null);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDeleting(false);
    }
  };

  const waiting = items?.filter((x) => x.status !== 'done').length || 0;

  return (
    <div>
      <PageHeader
        title="Chờ đồng bộ"
        sub={waiting > 0 ? `${waiting} mục chưa gửi lên máy chủ` : 'Không còn mục nào chờ gửi'}
      />

      {/* Trạng thái mạng + nút đồng bộ */}
      <div className="card p-4 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <div className="min-w-0">
            <div className="font-semibold text-[14px]">{online ? 'Đang có mạng' : 'Đang offline'}</div>
            <div className="text-[12px] text-ink-muted">
              {online ? 'Hàng đợi sẽ được gửi tự động' : 'Sẽ tự gửi khi có mạng trở lại'}
            </div>
          </div>
        </div>
        <button className="btn-primary shrink-0" disabled={!online || syncing} onClick={doFlush}>
          {syncing ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '🔄'} Đồng bộ ngay
        </button>
      </div>

      {items === null ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Không có dữ liệu chờ đồng bộ"
          hint="Mọi thứ đã được gửi lên máy chủ ✓"
        />
      ) : (
        <div className="grid gap-2.5">
          {items.map((it) => (
            <OutboxItem key={it.id} item={it} onRetry={doRetry} onAskDelete={setAskDelete} />
          ))}
        </div>
      )}

      <p className="text-[12.5px] text-ink-muted text-center mt-6 px-4">
        Dữ liệu chấm công/điểm danh khi mất mạng được lưu tại đây và tự gửi khi có mạng trở lại.
      </p>

      {/* Xác nhận xoá mục lỗi */}
      <ConfirmSheet
        open={!!askDelete}
        onClose={() => setAskDelete(null)}
        onConfirm={doDelete}
        danger
        busy={deleting}
        title="Xoá bản ghi chờ gửi?"
        confirmLabel="Xoá vĩnh viễn"
        message={
          askDelete
            ? `Bản ghi "${askDelete.label}" CHƯA được gửi lên máy chủ. Xoá sẽ mất vĩnh viễn dữ liệu này (kèm ảnh minh chứng nếu có) và không thể khôi phục. Bạn chắc chắn muốn xoá?`
            : ''
        }
      />
    </div>
  );
}
