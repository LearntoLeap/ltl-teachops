/**
 * routes/files.js — Tải lên & phục vụ tệp (docs/API.md mục 13).
 *
 * - POST /api/files        : upload rời qua multipart, trả danh sách tệp đã lưu.
 * - GET  /api/files/:id    : kiểm quyền rồi stream tệp gốc (?download=1 → tải về).
 * - GET  /api/files/:id/thumb : ảnh thu nhỏ 480px, cache 1 năm; không phải ảnh → bản gốc.
 *
 * Token qua query ?token= đã được lib/auth (extractToken) xử lý toàn cục —
 * thẻ <img src="/api/files/..?token=..."> dùng được trực tiếp.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { consumeMultipart, getFileForUser, getThumbPath, absPath } from '../lib/storage.js';
import { assertSchoolAccess } from '../lib/scope.js';
import { uuid, bool } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Header Content-Disposition an toàn với tên tệp tiếng Việt:
 * filename= chỉ giữ ASCII (client cũ), filename*= mã hoá UTF-8 (RFC 5987).
 */
function contentDisposition(kind, fileName) {
  const name = String(fileName || 'tep');
  const ascii = name.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_') || 'tep';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** stat tệp trên đĩa; mất tệp ⇒ 404 (bản ghi DB có thể còn nhưng đĩa đã mất). */
async function statOrNotFound(abs) {
  try {
    return await stat(abs);
  } catch {
    throw notFound('Tệp không còn tồn tại trên máy chủ.');
  }
}

export default async function routes(app) {
  /* ---------------------- POST /api/files — upload rời --------------------- */
  app.post('/api/files', async (req) => {
    // Gắn tệp vào một trường (tuỳ chọn) để soát quyền xem về sau: ?school_id=
    const schoolId = uuid(req.query.school_id, 'school_id');
    if (schoolId) await assertSchoolAccess(req.user, schoolId);

    const { files } = await consumeMultipart(req, { userId: req.user.id, schoolId });

    // Gom mọi field thành một mảng phẳng — màn hình upload rời không quan tâm tên field.
    const saved = Object.values(files).flat();
    if (!saved.length) throw badRequest('Không nhận được tệp nào trong yêu cầu.');

    return saved.map((f) => ({
      id: f.id,
      file_name: f.file_name,
      url: `/api/files/${f.id}`,
      mime: f.mime,
      size_bytes: f.size_bytes,
    }));
  });

  /* ------------------- GET /api/files/:id — stream tệp gốc ----------------- */
  app.get('/api/files/:id', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const f = await getFileForUser(req.user, id);

    const abs = absPath(f);
    const st = await statOrNotFound(abs);

    const download = bool(req.query.download, 'download', { def: false });
    reply
      .header('Content-Type', f.mime)
      .header('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', f.file_name))
      .header('Content-Length', st.size)
      .header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(abs));
  });

  /* -------------- GET /api/files/:id/thumb — ảnh thu nhỏ 480px ------------- */
  app.get('/api/files/:id/thumb', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const f = await getFileForUser(req.user, id);

    // Không phải ảnh, hoặc không tạo được thumbnail ⇒ trả bản gốc.
    const thumb = await getThumbPath(f, 480);
    const abs = thumb || absPath(f);
    const st = await statOrNotFound(abs);

    reply
      .header('Content-Type', thumb ? 'image/jpeg' : f.mime)
      .header('Content-Disposition', contentDisposition('inline', f.file_name))
      .header('Content-Length', st.size)
      // Nội dung theo id là bất biến ⇒ cache dài hạn phía trình duyệt.
      .header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(abs));
  });
}
