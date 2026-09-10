/**
 * storage.js — Nhận tệp tải lên, ghi ra đĩa, tạo bản ghi `files`.
 *
 * Nguyên tắc:
 *   - Không lưu nội dung tệp trong DB, chỉ lưu đường dẫn tương đối.
 *   - Ảnh được nén lại phía server (cạnh dài ≤ 1600px, JPEG q80) để tiết kiệm ổ đĩa
 *     và băng thông cho giáo viên dùng 3G ở tỉnh.
 *   - Tên tệp trên đĩa do server sinh — không bao giờ dùng tên người dùng gửi lên
 *     (chống path traversal).
 */
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import env from '../env.js';
import { one, query } from '../db.js';
import { badRequest, tooLarge, notFound, forbidden } from './errors.js';
import { visibleSchoolIds } from './scope.js';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
]);

export const isImage = (mime) => IMAGE_MIMES.has(String(mime).toLowerCase());
const isAllowed = (mime) => isImage(mime) || DOC_MIMES.has(String(mime).toLowerCase());

/** Thư mục theo năm/tháng để một thư mục không phình quá lớn. */
function relDir(d = new Date()) {
  return path.posix.join(String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
}

async function ensureDir(abs) {
  await fs.mkdir(abs, { recursive: true });
}

/**
 * Lưu một phần multipart thành tệp + bản ghi `files`.
 * @param {object} part      Phần multipart của @fastify/multipart (có .file stream, .mimetype, .filename)
 * @param {object} opts      { userId, schoolId }
 * @returns {Promise<object>} bản ghi files
 */
export async function saveUpload(part, { userId, schoolId = null } = {}) {
  if (!part || !part.file) throw badRequest('Không nhận được tệp tải lên.');

  const mime = String(part.mimetype || 'application/octet-stream').toLowerCase();
  if (!isAllowed(mime)) {
    throw badRequest(`Định dạng tệp không được hỗ trợ: ${mime}. Chỉ nhận ảnh (JPG/PNG/WEBP/HEIC) và tài liệu (PDF/DOCX/PPTX/XLSX).`);
  }

  // Đọc vào bộ nhớ có giới hạn — @fastify/multipart đã chặn ở mức limits.fileSize,
  // ở đây kiểm lại để chắc chắn và để phát hiện cờ truncated.
  const chunks = [];
  let size = 0;
  for await (const chunk of part.file) {
    size += chunk.length;
    if (size > env.maxUploadBytes) {
      throw tooLarge(`Tệp vượt quá ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB.`);
    }
    chunks.push(chunk);
  }
  if (part.file.truncated) {
    throw tooLarge(`Tệp vượt quá ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB.`);
  }
  let buf = Buffer.concat(chunks);
  if (!buf.length) throw badRequest('Tệp rỗng.');

  let outMime = mime;
  let ext = path.extname(part.filename || '').toLowerCase().slice(0, 8) || '';
  let width = null;
  let height = null;

  if (isImage(mime)) {
    try {
      const img = sharp(buf, { failOn: 'none' }).rotate(); // rotate() tôn trọng EXIF orientation
      const meta = await img.metadata();
      const resized = await img
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      buf = resized.data;
      width = resized.info.width;
      height = resized.info.height;
      outMime = 'image/jpeg';
      ext = '.jpg';
      void meta;
    } catch (e) {
      // Ảnh hỏng hoặc định dạng sharp không đọc được (một số HEIC) — giữ nguyên bản gốc.
      console.warn('[storage] Không xử lý được ảnh, giữ nguyên bản gốc:', e.message);
      if (!ext) ext = '.bin';
    }
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const dir = relDir();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const storagePath = path.posix.join(dir, name);
  const absDir = path.join(env.uploadDir, dir);

  await ensureDir(absDir);
  await fs.writeFile(path.join(env.uploadDir, storagePath), buf);

  const row = await one(
    `insert into files (storage_path, file_name, mime, size_bytes, sha256, width, height, uploaded_by, school_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      storagePath,
      String(part.filename || name).slice(0, 200),
      outMime,
      buf.length,
      sha256,
      width,
      height,
      userId || null,
      schoolId,
    ]
  );
  return row;
}

/**
 * Duyệt toàn bộ phần multipart của một request: tách trường văn bản và tệp.
 * Trả { fields: {...}, files: { fieldname: [fileRow, ...] } }
 */
export async function consumeMultipart(req, { userId, schoolId = null } = {}) {
  const fields = {};
  const files = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const row = await saveUpload(part, { userId, schoolId });
      (files[part.fieldname] ||= []).push(row);
    } else {
      // Trường lặp lại ⇒ gom thành mảng
      if (fields[part.fieldname] !== undefined) {
        fields[part.fieldname] = [].concat(fields[part.fieldname], part.value);
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  }
  return { fields, files };
}

/** Đường dẫn tuyệt đối của một bản ghi files. */
export const absPath = (fileRow) => path.join(env.uploadDir, fileRow.storage_path);

/**
 * Lấy bản ghi tệp sau khi kiểm quyền xem.
 * Quy tắc: admin xem tất cả; người tải lên luôn xem được tệp của mình;
 * còn lại phải cùng phạm vi trường.
 */
export async function getFileForUser(user, fileId) {
  const f = await one('select * from files where id = $1', [fileId]);
  if (!f) throw notFound('Không tìm thấy tệp.');
  if (user.role === 'admin') return f;
  if (f.uploaded_by === user.id) return f;

  // Tệp không gắn trường (ví dụ học liệu chung) ⇒ mọi người đã đăng nhập đều xem được.
  if (!f.school_id) return f;

  const ids = await visibleSchoolIds(user);
  if (ids === null || ids.includes(f.school_id)) return f;
  throw notFound('Không tìm thấy tệp.');
}

/** Ảnh thu nhỏ, tạo một lần rồi lưu cạnh bản gốc (`<tên>.thumb.jpg`). */
export async function getThumbPath(fileRow, size = 480) {
  if (!isImage(fileRow.mime)) return null;
  const src = absPath(fileRow);
  const thumb = src.replace(/(\.[^.]+)?$/, `.thumb${size}.jpg`);
  try {
    await fs.access(thumb);
    return thumb;
  } catch { /* chưa có, tạo mới */ }

  try {
    await sharp(src)
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toFile(thumb);
    return thumb;
  } catch (e) {
    console.warn('[storage] Không tạo được ảnh thu nhỏ:', e.message);
    return null;
  }
}

/** Xoá tệp khỏi đĩa + DB (dùng khi gỡ học liệu). Không ném lỗi nếu đĩa đã mất tệp. */
export async function deleteFile(fileId) {
  const f = await one('select * from files where id = $1', [fileId]);
  if (!f) return;
  const p = absPath(f);
  await fs.unlink(p).catch(() => {});
  await fs.unlink(p.replace(/(\.[^.]+)?$/, '.thumb480.jpg')).catch(() => {});
  await query('delete from files where id = $1', [fileId]);
}

/** Bảo đảm thư mục tải lên tồn tại và ghi được — gọi lúc khởi động. */
export async function initStorage() {
  await ensureDir(env.uploadDir);
  const probe = path.join(env.uploadDir, '.write-test');
  await fs.writeFile(probe, 'ok');
  await fs.unlink(probe);
  console.log('[storage] Thư mục tệp sẵn sàng:', env.uploadDir);
}

/** Chặn stream ghi tệp lớn (dùng cho tải xuống). */
export async function streamToFile(readable, absDest) {
  await ensureDir(path.dirname(absDest));
  await pipeline(readable, createWriteStream(absDest));
}

export { forbidden };
