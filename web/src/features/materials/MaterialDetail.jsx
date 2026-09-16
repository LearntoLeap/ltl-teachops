/**
 * MaterialDetail.jsx — Chi tiết học liệu (/hoc-lieu/:id).
 * Thông tin + tải về bản mới nhất, lịch sử phiên bản, duyệt/từ chối (khu vực Giáo viên),
 * và bình luận góp ý. Tự đánh dấu đã đọc khi mở.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtAgo, fmtDateTime, fmtSize, initials, LABEL } from '../../lib/format.js';
import {
  Badge, ErrorBox, Field, PageLoading, Sheet, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { MAX_MATERIAL_MB, materialFileProblem } from '../../lib/limits.js';
import DeleteMaterialSheet from './DeleteMaterialSheet.jsx';

/** Số hiệu phiên bản — chịu được vài kiểu đặt tên trường từ server. */
const verNo = (v, fallback) => v.version_no ?? v.version ?? fallback;

/* --------------------------- Sheet phiên bản mới --------------------------- */
function VersionSheet({ open, onClose, materialId, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!file) { toast.err('Vui lòng chọn tệp cho phiên bản mới.'); return; }
    const problem = materialFileProblem(file);
    if (problem) { toast.err(problem, 8000); return; }
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (note.trim()) fd.append('change_note', note.trim());
    setBusy(true);
    try {
      await api.upload(`/api/materials/${materialId}/versions`, fd);
      toast.ok('Đã đăng phiên bản mới.');
      setFile(null); setFileKey((k) => k + 1); setNote('');
      onDone();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Phiên bản mới">
      <form onSubmit={submit}>
        <Field label="Tệp tài liệu" required hint={`PDF, Word, PowerPoint, Excel, video — tối đa ${MAX_MATERIAL_MB} MB.`}>
          <input
            key={fileKey}
            type="file"
            className="input !py-2"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.webm,.m4v,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              const problem = materialFileProblem(f);
              if (problem) { toast.err(problem, 8000); e.target.value = ''; setFile(null); return; }
              setFile(f);
            }}
          />
        </Field>
        <Field label="Ghi chú thay đổi" hint="Mô tả ngắn: sửa gì, thêm gì so với bản trước.">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Cập nhật slide 12–15 theo góp ý của Phòng chuyên môn." />
        </Field>
        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang tải lên…</> : 'Đăng phiên bản'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* -------------------------------- Màn hình -------------------------------- */
export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();

  const [mat, setMat] = useState(null);
  const [error, setError] = useState(null);

  const [verOpen, setVerOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const [deciding, setDeciding] = useState(null);     // 'approved' | 'rejected' đang gửi
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const [delOpen, setDelOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMat(await api.get(`/api/materials/${id}`));
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Đánh dấu đã đọc khi mở — lỗi thì bỏ qua, không làm phiền người dùng.
  useEffect(() => {
    api.post(`/api/materials/${id}/read`).catch(() => {});
  }, [id]);

  if (error && !mat) return <ErrorBox error={error} onRetry={load} />;
  if (!mat) return <PageLoading />;

  const ownerId = mat.owner?.id ?? mat.owner_id;
  const ownerName = mat.owner_name || mat.owner?.full_name || '';
  const canAddVersion = ownerId === auth.user?.id || auth.isAdmin || auth.isManager;
  const canApprove = auth.can('material.approve') && mat.area === 'teacher' && mat.approval_status === 'pending';

  const versions = [...(mat.versions || [])]
    .sort((a, b) => (verNo(b, 0) - verNo(a, 0)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const latest = versions[0] || null;
  const comments = mat.comments || [];

  const downloadVersion = async (v) => {
    const fileId = v.file_id || v.file?.id;
    if (!fileId) { toast.err('Phiên bản này thiếu tệp đính kèm.'); return; }
    setDownloadingId(fileId);
    try {
      await api.download(`/api/files/${fileId}`, { download: 1 }, v.file_name || 'tai-lieu');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDownloadingId(null);
    }
  };

  const decide = async (decision, note) => {
    setDeciding(decision);
    try {
      await api.post(`/api/materials/${id}/approve`, note ? { decision, note } : { decision });
      toast.ok(decision === 'approved' ? 'Đã duyệt tài liệu.' : 'Đã từ chối tài liệu.');
      setRejectOpen(false);
      setRejectNote('');
      await load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDeciding(null);
    }
  };

  const sendComment = async (e) => {
    e.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    setSending(true);
    try {
      await api.post(`/api/materials/${id}/comments`, { body });
      setCommentText('');
      await load();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-3.5">
      {/* ------------------------------ Đầu trang ------------------------------ */}
      <div>
        <Link to="/hoc-lieu" className="text-[13px] text-brand-700 font-semibold">‹ Kho học liệu</Link>
        <div className="card p-4 mt-2">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            {mat.type_name && <Badge tone="neutral">{mat.type_icon} {mat.type_name}</Badge>}
            {mat.grade && <Badge tone="new">Khối {mat.grade}</Badge>}
            {mat.level && <Badge tone="neutral">{LABEL.level[mat.level] || mat.level}</Badge>}
            {mat.area && <Badge tone="neutral">{LABEL.area[mat.area] || mat.area}</Badge>}
            {mat.area === 'teacher' && mat.approval_status && (
              <Badge tone={mat.approval_status}>{LABEL.approval[mat.approval_status] || mat.approval_status}</Badge>
            )}
            {mat.subject && <Badge tone="low">{mat.subject}</Badge>}
          </div>
          <h1 className="text-lg font-bold text-ink leading-snug">{mat.title}</h1>
          <div className="text-[13px] text-ink-muted mt-1">
            {ownerName && <>Đăng bởi <span className="font-semibold text-ink-soft">{ownerName}</span></>}
            {(mat.updated_at || mat.created_at) && <> · {fmtAgo(mat.updated_at || mat.created_at)}</>}
          </div>
          {(mat.lesson_no || mat.lesson_title || mat.curriculum) && (
            <div className="mt-2.5 rounded-xl bg-brand-50/70 border border-brand-100 px-3.5 py-2.5 text-[13.5px] font-medium text-brand-900">
              📖 {[mat.lesson_no ? `Tiết ${mat.lesson_no}` : null, mat.lesson_title, mat.curriculum]
                .filter(Boolean).join(' — ')}
            </div>
          )}
          {mat.description && (
            <p className="text-[14px] text-ink-soft mt-2.5 whitespace-pre-line">{mat.description}</p>
          )}
          {mat.body && (
            <div className="mt-3 rounded-xl border border-line bg-canvas/60 px-4 py-3.5 text-[14px] leading-relaxed whitespace-pre-line">
              {mat.body}
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            {latest && (
              <>
              <button
                className="btn-primary"
                disabled={downloadingId === (latest.file_id || latest.file?.id)}
                onClick={() => downloadVersion(latest)}>
                {downloadingId === (latest.file_id || latest.file?.id)
                  ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang tải…</>
                  : <>⬇️ Tải về bản mới nhất</>}
              </button>
              <span className="text-[12.5px] text-ink-muted truncate max-w-[240px]">
                v{verNo(latest, versions.length)} · {latest.file_name} {fmtSize(latest.size_bytes) && `· ${fmtSize(latest.size_bytes)}`}
              </span>
              </>
            )}
            {canAddVersion && (
              <button className="btn-line !text-rose-700 ml-auto" onClick={() => setDelOpen(true)}>
                🗑 Xoá tài liệu
              </button>
            )}
          </div>
        </div>
      </div>

      {/* --------------------------- Thanh duyệt tài liệu ----------------------- */}
      {canApprove && (
        <div className="card border-amber-200 bg-amber-50/70 p-4">
          <div className="text-[13.5px] font-semibold text-amber-800 mb-2.5">
            Tài liệu giáo viên đang chờ Phòng chuyên môn duyệt.
          </div>
          <div className="flex gap-2.5">
            <button className="btn-primary" disabled={!!deciding} onClick={() => decide('approved')}>
              {deciding === 'approved' ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '✓ Duyệt'}
            </button>
            <button className="btn-danger" disabled={!!deciding} onClick={() => setRejectOpen(true)}>
              ✕ Từ chối
            </button>
          </div>
        </div>
      )}

      {/* --------------------------- Lịch sử phiên bản ------------------------- */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <div className="font-bold text-[15px]">Lịch sử phiên bản</div>
          {canAddVersion && (
            <button className="btn-line !py-1.5 !px-3" onClick={() => setVerOpen(true)}>+ Phiên bản mới</button>
          )}
        </div>
        {versions.length === 0 ? (
          <div className="px-4 pb-4 text-[13px] text-ink-muted">Chưa có phiên bản nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Bản</th>
                  <th className="th">Tệp</th>
                  <th className="th">Dung lượng</th>
                  <th className="th">Người đăng</th>
                  <th className="th">Thời gian</th>
                  <th className="th">Ghi chú thay đổi</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => {
                  const fileId = v.file_id || v.file?.id;
                  return (
                    <tr key={v.id || fileId || i}>
                      <td className="td font-bold text-brand-800">v{verNo(v, versions.length - i)}</td>
                      <td className="td max-w-[220px] truncate">{v.file_name}</td>
                      <td className="td whitespace-nowrap">{fmtSize(v.size_bytes)}</td>
                      <td className="td whitespace-nowrap">{v.uploaded_by_name || v.created_by_name || v.uploader?.full_name || ''}</td>
                      <td className="td whitespace-nowrap">{fmtDateTime(v.created_at || v.uploaded_at)}</td>
                      <td className="td text-ink-muted max-w-[240px]">{v.change_note || '—'}</td>
                      <td className="td">
                        <button
                          className="btn-line !px-2.5 !py-1 text-[12.5px]"
                          disabled={downloadingId === fileId}
                          onClick={() => downloadVersion(v)}>
                          {downloadingId === fileId ? <Spinner className="h-3.5 w-3.5" /> : '⬇️ Tải'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------------------------------- Bình luận ----------------------------- */}
      <div className="card p-4">
        <div className="font-bold text-[15px] mb-3">
          Góp ý & trao đổi {comments.length > 0 && <span className="text-ink-muted font-semibold">({comments.length})</span>}
        </div>

        {comments.length === 0 ? (
          <div className="text-[13px] text-ink-muted mb-3">
            Chưa có góp ý nào. Hãy là người đầu tiên trao đổi về tài liệu này.
          </div>
        ) : (
          <div className="grid gap-3 mb-3.5">
            {comments.map((c, i) => {
              const name = c.user_name || c.full_name || c.author?.full_name || 'Người dùng';
              const role = c.role || c.user_role || c.author?.role;
              return (
                <div key={c.id || i} className="flex gap-2.5">
                  <span className="h-8 w-8 shrink-0 rounded-full bg-brand-grad-soft text-white grid place-items-center text-[13px] font-bold">
                    {initials(name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap text-[13px]">
                      <span className="font-semibold text-ink">{name}</span>
                      {role && <Badge tone="neutral" className="!text-[11px]">{LABEL.role[role] || role}</Badge>}
                      <span className="text-ink-muted text-[12px]">{fmtAgo(c.created_at)}</span>
                    </div>
                    <div className="text-[14px] text-ink-soft mt-0.5 whitespace-pre-line">{c.body || c.content}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={sendComment} className="flex items-end gap-2">
          <textarea
            className="input flex-1"
            rows={2}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Viết góp ý cho tài liệu này…"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={sending || !commentText.trim()}>
            {sending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Gửi'}
          </button>
        </form>
      </div>

      {/* ------------------------------ Sheet phụ ------------------------------ */}
      <DeleteMaterialSheet
        open={delOpen}
        items={[{ id, title: mat.title }]}
        canHardDelete={auth.isAdmin || auth.isManager}
        onClose={() => setDelOpen(false)}
        onDone={(okIds) => {
          setDelOpen(false);
          if (okIds.length) navigate('/hoc-lieu', { replace: true });
        }}
      />

      <VersionSheet
        open={verOpen}
        onClose={() => setVerOpen(false)}
        materialId={id}
        onDone={() => { setVerOpen(false); load(); }}
      />

      <Sheet open={rejectOpen} onClose={deciding ? undefined : () => setRejectOpen(false)} title="Từ chối tài liệu">
        <Field label="Lý do từ chối" required hint="Ghi rõ lý do để giáo viên chỉnh sửa và gửi lại.">
          <textarea className="input" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Ví dụ: Nội dung slide 8 chưa khớp giáo trình, vui lòng cập nhật." />
        </Field>
        <div className="flex gap-2.5 justify-end mt-4">
          <button className="btn-line" onClick={() => setRejectOpen(false)} disabled={!!deciding}>Huỷ</button>
          <button
            className="btn-danger"
            disabled={!!deciding}
            onClick={() => {
              if (!rejectNote.trim()) { toast.err('Vui lòng nhập lý do từ chối.'); return; }
              decide('rejected', rejectNote.trim());
            }}>
            {deciding === 'rejected' ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : 'Từ chối'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
