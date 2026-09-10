/**
 * NotificationBell.jsx — Chuông thông báo: badge số chưa đọc, danh sách trượt xuống,
 * kết nối SSE để nhận realtime.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_URL, tokens } from '../lib/api.js';
import { fmtAgo } from '../lib/format.js';
import { Sheet, Spinner, EmptyState } from './ui.jsx';

const KIND_ICON = {
  material_new: '📚', material_reviewed: '✅', material_comment: '💬',
  feedback_new: '📨', feedback_reply: '💬', feedback_update: '🔧',
  device_issue: '🛠️', device_issue_update: '🔧',
  attendance_missing: '📋', checkout_missing: '⏰',
  schedule_reminder: '🗓️', timesheet_flagged: '📍', timesheet_reviewed: '✅',
};

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const esRef = useRef(null);
  const navigate = useNavigate();

  const refreshCount = useCallback(async () => {
    try {
      const d = await api.get('/api/notifications', { limit: 1, unread: 1 });
      setUnread(d.total_unread ?? d.total ?? 0);
    } catch { /* im lặng — chuông không được làm hỏng app */ }
  }, []);

  // SSE realtime; tự kết nối lại khi đứt (EventSource có retry sẵn).
  useEffect(() => {
    refreshCount();
    if (!tokens.access) return;

    const es = new EventSource(`${API_URL}/api/notifications/stream?token=${encodeURIComponent(tokens.access)}`);
    esRef.current = es;
    es.addEventListener('notification', () => {
      setUnread((n) => n + 1);
      // Đang mở danh sách thì nạp lại cho thấy mục mới.
      setItems((cur) => (cur ? undefined : cur) ?? cur);
    });
    es.onerror = () => { /* EventSource tự retry */ };
    return () => es.close();
  }, [refreshCount]);

  const openList = async () => {
    setOpen(true);
    setItems(null);
    try {
      const d = await api.get('/api/notifications', { limit: 30 });
      setItems(d.items || []);
      setUnread(d.total_unread ?? 0);
    } catch {
      setItems([]);
    }
  };

  const clickItem = async (n) => {
    if (!n.read_at) {
      api.post(`/api/notifications/${n.id}/read`).catch(() => {});
      setUnread((x) => Math.max(0, x - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    try {
      await api.post('/api/notifications/read-all');
      setUnread(0);
      setItems((xs) => (xs || []).map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    } catch { /* bỏ qua */ }
  };

  return (
    <>
      <button
        onClick={openList}
        className="relative h-9 w-9 grid place-items-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition"
        aria-label="Thông báo">
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10.5px] font-bold grid place-items-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Thông báo">
        {items === null ? (
          <div className="py-10 text-center"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon="🔕" title="Chưa có thông báo nào" />
        ) : (
          <>
            {unread > 0 && (
              <button className="btn-ghost !py-1.5 mb-2 text-[13px]" onClick={readAll}>
                Đánh dấu tất cả đã đọc
              </button>
            )}
            <div className="divide-y divide-line -mx-2">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => clickItem(n)}
                  className={`w-full text-left px-2 py-3 flex gap-3 hover:bg-brand-50/50 rounded-lg transition
                    ${!n.read_at ? 'bg-brand-50/40' : ''}`}>
                  <span className="text-xl shrink-0">{KIND_ICON[n.kind] || '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14px] ${!n.read_at ? 'font-semibold' : 'font-medium text-ink-soft'}`}>
                      {n.title}
                    </span>
                    {n.body && <span className="block text-[12.5px] text-ink-muted mt-0.5 line-clamp-2">{n.body}</span>}
                    <span className="block text-[11.5px] text-ink-muted mt-1">{fmtAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="h-2 w-2 rounded-full bg-brand-500 mt-2 shrink-0" />}
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
