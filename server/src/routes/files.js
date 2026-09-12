/**
 * routes/files.js — Tải lên & phục vụ tệp (docs/API.md mục 13).
 *
 * - POST /api/files        : upload rời qua multipart, trả danh sách tệp đã lưu.
 * - GET  /api/files/:id    : kiểm quyền rồi stream tệp gốc (?download=1 → tải về).
 *                            Hỗ trợ Range (tua video, iPhone bắt buộc có). Bản gốc đã
 *                            chuyển sang Google Drive ⇒ lấy từ Drive rồi chuyển tiếp.
 * - GET  /api/files/:id/thumb : ảnh thu nhỏ 480px, cache 1 năm; video ⇒ ảnh bìa có nút ▶.
 *
 * Token qua query ?token= đã được lib/auth (extractToken) xử lý toàn cục —
 * thẻ <img>/<video src="/api/files/..?token=..."> dùng được trực tiếp.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  consumeMultipart, getFileForUser, getThumbPath, absPath, contentDisposition, isVideo,
} from '../lib/storage.js';
import { fetchFromDrive } from '../lib/drive.js';
import { assertSchoolAccess } from '../lib/scope.js';
import { uuid, bool } from '../lib/validate.js';
import { badRequest, notFound, AppError } from '../lib/errors.js';

const statOrNull = (abs) => stat(abs).catch(() => null);

/** 'bytes=100-' · 'bytes=100-199' · 'bytes=-500' → {start, end}; không hợp lệ ⇒ null. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/** Ảnh bìa cho video (không cần ffmpeg): nền tím, nút ▶, dung lượng. */
function videoPoster(f) {
  const mb = (Number(f.size_bytes || 0) / 1024 / 1024).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a3f97"/><stop offset="1" stop-color="#4f2a78"/></linearGradient></defs>
<rect width="480" height="480" fill="url(#g)"/>
<circle cx="240" cy="220" r="78" fill="#fff" fill-opacity=".92"/>
<path d="M214 178 L292 220 L214 262 Z" fill="#6f3fa2"/>
<text x="240" y="352" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="#fff">VIDEO</text>
<text x="240" y="394" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="26" fill="#f3e8f6">${mb} MB</text>
</svg>`;
}

/** Chuyển tiếp tệp từ Google Drive (bản gốc đã rời VPS). */
async function sendFromDrive(f, req, reply, disposition) {
  if (!f.drive_file_id) throw notFound('Tệp không còn tồn tại trên máy chủ.');
  let res;
  try {
    res = await fetchFromDrive(f.drive_file_id, req.headers.range);
  } catch (e) {
    throw new AppError(503, 'DRIVE_UNAVAILABLE', `Chưa lấy được tệp từ Google Drive: ${e.message}`);
  }
  if (!res.ok && res.status !== 206) {
    throw new AppError(502, 'DRIVE_ERROR', `Google Drive trả lỗi ${res.status} khi lấy tệp.`);
  }
  reply.code(res.status)
    .header('Content-Type', f.mime)
    .header('Content-Disposition', disposition)
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'private, max-age=3600');
  for (const h of ['content-length', 'content-range']) {
    const v = res.headers.get(h);
    if (v) reply.header(h, v);
  }
  return reply.send(Readable.fromWeb(res.body));
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
    const download = bool(req.query.download, 'download', { def: false });
    const disposition = contentDisposition(download ? 'attachment' : 'inline', f.file_name);

    const abs = absPath(f);
    const st = await statOrNull(abs);
    if (!st) return sendFromDrive(f, req, reply, disposition);

    reply
      .header('Content-Type', f.mime)
      .header('Content-Disposition', disposition)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, max-age=3600');

    if (req.headers.range) {
      const r = parseRange(req.headers.range, st.size);
      if (!r) {
        return reply.code(416).header('Content-Range', `bytes */${st.size}`).send();
      }
      return reply.code(206)
        .header('Content-Range', `bytes ${r.start}-${r.end}/${st.size}`)
        .header('Content-Length', r.end - r.start + 1)
        .send(createReadStream(abs, { start: r.start, end: r.end }));
    }
    return reply.header('Content-Length', st.size).send(createReadStream(abs));
  });

  /* -------------- GET /api/files/:id/thumb — ảnh thu nhỏ 480px ------------- */
  app.get('/api/files/:id/thumb', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const f = await getFileForUser(req.user, id);
    // Nội dung theo id là bất biến ⇒ cache dài hạn phía trình duyệt.
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');

    if (isVideo(f.mime)) {
      return reply.header('Content-Type', 'image/svg+xml; charset=utf-8').send(videoPoster(f));
    }

    let thumb = await getThumbPath(f, 480);
    if (!thumb && f.drive_file_id && !(await statOrNull(absPath(f)))) {
      // Ảnh đã chuyển sang Drive mà chưa có bản thu nhỏ ⇒ lấy về một lần để tạo.
      const res = await fetchFromDrive(f.drive_file_id).catch(() => null);
      if (res?.ok) thumb = await getThumbPath(f, 480, { buffer: Buffer.from(await res.arrayBuffer()) });
    }
    const abs = thumb || absPath(f);
    const st = await statOrNull(abs);
    if (!st) {
      // Không phải ảnh (tài liệu) và bản gốc đã rời VPS ⇒ chuyển tiếp nguyên tệp từ Drive.
      return sendFromDrive(f, req, reply, contentDisposition('inline', f.file_name));
    }
    return reply
      .header('Content-Type', thumb ? 'image/jpeg' : f.mime)
      .header('Content-Disposition', contentDisposition('inline', f.file_name))
      .header('Content-Length', st.size)
      .send(createReadStream(abs));
  });
}
