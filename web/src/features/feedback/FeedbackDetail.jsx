/**
 * FeedbackDetail.jsx — Chi tiết một góp ý + luồng trao đổi (route /gop-y/:id).
 *
 * - Đầu trang: tiêu đề + badge, nội dung, ảnh minh hoạ, thông tin trường/lớp/phòng, người gửi.
 * - Luồng trao đổi: các trả lời; trả lời có status_to hiện dòng hệ thống "Chuyển trạng thái → X".
 * - `feedback.resolve` (admin/manager): kèm chuyển trạng thái khi trả lời + nút "Nhận xử lý".
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtAgo, fmtDateTime, initials } from '../../lib/format.js';
import { useToast } from '../../components/Toast.jsx';
import { Badge, ErrorBox, PageLoading, Spinner } from '../../components/ui.jsx';

/** Id tệp ảnh — chịu được cả mảng id lẫn mảng object. */
const fileIdOf = (p) => (p && typeof p === 'object' ? p.file_id || p.id : p);

/* ----------------------------- Một dòng trao đổi --------------------------- */
function ReplyRow({ r }) {
  const name = r.user_name || r.created_by_name || r.author_name || r.user?.full_name || 'Người dùng';
  const role = r.user_role || r.role || r.user?.role;
  return (
    <div>
      {r.status_to && (
        <div className="flex items-center justify-center gap-1.5 text-[12px] text-ink-muted mb-1.5">
          <span>⚙️ Chuyển trạng thái →</span>
          <Badge tone={r.status_to}>{LABEL.issue[r.status_to] || r.status_to}</Badge>
        </div>
      )}
      {r.body && (
        <div className="flex gap-2.5">
          <span className="h-8 w-8 shrink-0 rounded-full bg-brand-grad-soft text-white grid place-items-center text-[13px] font-bold">
            {initials(name)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-[13.5px]">{name}</span>
              {role && <span className="text-[11.5px] text-brand-700 font-medium">{LABEL.role[role] || role}</span>}
              <span className="text-[11.5px] text-ink-muted">{fmtAgo(r.created_at)}</span>
            </div>
            <div className="text-[14px] text-ink-soft whitespace-pre-wrap mt-0.5">{r.body}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedbackDetail() {
  const { id } = useParams();
  const auth = useAuth();
  const toast = useToast();

  const canResolve = auth.can('feedback.resolve');

  const [fb, setFb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [body, setBody] = useState('');
  const [statusTo, setStatusTo] = useState('');
  const [sending, setSending] = useState(false);
  const [taking, setTaking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get(`/api/feedback/${id}`);
      setFb(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setFb(null);
    load();
  }, [load]);

  const sendReply = async () => {
    if (!body.trim()) { toast.err('Vui lòng nhập nội dung trả lời.'); return; }
    setSending(true);
    try {
      const payload = { body: body.trim() };
      if (canResolve && statusTo) payload.status_to = statusTo;
      await api.post(`/api/feedback/${id}/replies`, payload);
      toast.ok('Đã gửi trả lời.');
      setBody('');
      setStatusTo('');
      await load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSending(false);
    }
  };

  const takeOver = async () => {
    setTaking(true);
    try {
      await api.patch(`/api/feedback/${id}`, { assigned_to: auth.user.id, status: 'in_progress' });
      toast.ok('Bạn đã nhận xử lý góp ý này.');
      await load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setTaking(false);
    }
  };

  /* ---------------------------------- Render --------------------------------- */
  if (loading && !fb) return <PageLoading />;

  if (error && !fb) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link to="/gop-y" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 mb-3">
          ‹ Danh sách góp ý
        </Link>
        <ErrorBox error={error} onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  if (!fb) return null;

  const content = fb.body || fb.content;
  const photos = (fb.photos || fb.files || fb.photo_ids || []).map(fileIdOf).filter(Boolean);
  const replies = fb.replies || [];
  const school = fb.school_name || fb.school?.name;
  const klass = fb.class_name || fb.class?.name;
  const room = fb.room_name || fb.room?.name;
  const sender = fb.created_by_name || fb.creator_name || fb.creator?.full_name || fb.user?.full_name;
  const assignee = fb.assigned_to_name || fb.assignee_name || fb.assignee?.full_name;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/gop-y" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 mb-3">
        ‹ Danh sách góp ý
      </Link>

      {error && <ErrorBox error={error} onRetry={load} />}

      {/* ------------------------------ Nội dung góp ý --------------------------- */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-2.5">
          <h1 className="font-bold text-[17px] leading-snug">{fb.title}</h1>
          <Badge tone={fb.status} className="shrink-0">{LABEL.issue[fb.status] || fb.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Badge tone="neutral">{LABEL.category[fb.category] || fb.category || 'Khác'}</Badge>
          {fb.priority && <Badge tone={fb.priority}>Ưu tiên: {LABEL.priority[fb.priority] || fb.priority}</Badge>}
        </div>

        {content && (
          <p className="text-[14.5px] text-ink-soft whitespace-pre-wrap mt-3">{content}</p>
        )}

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {photos.map((pid) => (
              <a
                key={pid}
                href={fileUrl(pid)}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square rounded-xl overflow-hidden border border-line bg-brand-50">
                <img
                  src={fileUrl(pid, { thumb: true })}
                  alt="Ảnh minh hoạ góp ý"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-line text-[12.5px] text-ink-muted flex flex-col gap-1">
          {school && (
            <span>🏫 {school}{klass ? ` · Lớp ${klass}` : ''}{room ? ` · Phòng ${room}` : ''}</span>
          )}
          <span>👤 {sender || 'Không rõ người gửi'} · {fmtDateTime(fb.created_at)}</span>
          {assignee && <span>🛠️ Người xử lý: {assignee}</span>}
        </div>

        {canResolve && fb.status === 'new' && (
          <button className="btn-primary w-full mt-3" onClick={takeOver} disabled={taking}>
            {taking ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '🙋 Nhận xử lý góp ý này'}
          </button>
        )}
      </div>

      {/* ------------------------------ Luồng trao đổi --------------------------- */}
      <div className="mt-5">
        <div className="font-bold text-[14px] text-brand-900 mb-3">Trao đổi ({replies.length})</div>
        {replies.length === 0 && (
          <div className="text-[13px] text-ink-muted text-center py-4">Chưa có trả lời nào.</div>
        )}
        <div className="flex flex-col gap-4">
          {replies.map((r, i) => <ReplyRow key={r.id || i} r={r} />)}
        </div>
      </div>

      {/* -------------------------------- Ô trả lời ------------------------------ */}
      <div className="card p-4 mt-4">
        <div className="label">Trả lời</div>
        <textarea
          className="input"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Nhập nội dung trao đổi…"
        />
        <div className="flex flex-col sm:flex-row gap-2.5 mt-3">
          {canResolve && (
            <select className="input sm:flex-1" value={statusTo} onChange={(e) => setStatusTo(e.target.value)}>
              <option value="">Kèm chuyển trạng thái: giữ nguyên</option>
              <option value="in_progress">Kèm chuyển trạng thái: Đang xử lý</option>
              <option value="resolved">Kèm chuyển trạng thái: Đã khắc phục</option>
            </select>
          )}
          <button className="btn-primary sm:ml-auto" onClick={sendReply} disabled={sending}>
            {sending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Gửi trả lời'}
          </button>
        </div>
      </div>
    </div>
  );
}
