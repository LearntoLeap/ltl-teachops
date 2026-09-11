/**
 * drive.js — Sao lưu ảnh/tài liệu lên Google Drive của tài khoản quản trị chính.
 *
 * CÁCH XÁC THỰC: OAuth 2.0 refresh token (KHÔNG dùng Service Account).
 * Lý do: Service Account không có dung lượng Drive riêng, nên khi tải tệp vào
 * thư mục được chia sẻ từ một tài khoản Gmail thường, Google trả lỗi
 * "Service Accounts do not have storage quota". Với refresh token, hệ thống tải
 * tệp lên ĐÚNG danh nghĩa tài khoản quản trị → tính vào dung lượng của tài khoản
 * đó và hiện ngay trong "Drive của tôi".
 *
 * Gọi trực tiếp REST API của Drive bằng fetch — không thêm phụ thuộc nào.
 *
 * Luồng: job nền quét bảng `files` chưa có drive_file_id → tải lên → ghi lại
 * drive_file_id + drive_link. Tệp trên VPS KHÔNG bị xoá (Drive là bản sao).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../env.js';
import { one, rows, query } from '../db.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const API_URL = 'https://www.googleapis.com/drive/v3/files';

/** Đã cấu hình đủ để bật đồng bộ chưa? */
export const driveEnabled = () =>
  !!(env.drive.clientId && env.drive.clientSecret && env.drive.refreshToken);

/* --------------------------- Access token (có cache) ------------------------ */
let _token = null;          // { value, expiresAt }

async function getAccessToken() {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const body = new URLSearchParams({
    client_id: env.drive.clientId,
    client_secret: env.drive.clientSecret,
    refresh_token: env.drive.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // invalid_grant = refresh token bị thu hồi / đổi mật khẩu Google / hết hạn.
    const hint = data.error === 'invalid_grant'
      ? ' — refresh token không còn hiệu lực, chạy lại: npm run drive:auth'
      : '';
    throw new Error(`Google từ chối cấp access token: ${data.error || res.status}${hint}`);
  }

  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
  return _token.value;
}

/** Gọi Drive API kèm access token, tự thử lại một lần nếu token vừa hết hạn. */
async function driveFetch(url, opts = {}, retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    _token = null;
    return driveFetch(url, opts, false);
  }
  return res;
}

/* ------------------------------- Thư mục ----------------------------------- */

/** Tìm thư mục con theo tên trong thư mục cha; null nếu chưa có. */
async function findFolder(name, parentId) {
  const q = [
    `name = '${String(name).replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ');

  const res = await driveFetch(
    `${API_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1` +
    '&supportsAllDrives=true&includeItemsFromAllDrives=true'
  );
  if (!res.ok) throw new Error(`Không tra cứu được thư mục Drive (${res.status})`);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createFolder(name, parentId) {
  const res = await driveFetch(`${API_URL}?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Không tạo được thư mục "${name}" trên Drive: ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()).id;
}

/**
 * Bảo đảm cây thư mục tồn tại, trả về id thư mục lá.
 * Ví dụ segments = ['Tiểu học Xuân Hoà', '2026-09'] ⇒ tạo lồng nhau dưới thư mục gốc.
 * Ghi nhớ vào bảng drive_folders để lần sau không phải hỏi lại Drive.
 */
async function ensureFolderPath(segments) {
  let parentId = env.drive.rootFolderId;
  const walked = [];

  for (const raw of segments) {
    const name = String(raw || '').trim().replace(/[/\\]/g, '-') || 'Khac';
    walked.push(name);
    const cacheKey = walked.join('/');

    const cached = await one('select folder_id from drive_folders where path = $1', [cacheKey]);
    if (cached) { parentId = cached.folder_id; continue; }

    let id = await findFolder(name, parentId);
    if (!id) id = await createFolder(name, parentId);

    await query(
      'insert into drive_folders (path, folder_id) values ($1, $2) on conflict (path) do nothing',
      [cacheKey, id]
    );
    parentId = id;
  }
  return parentId;
}

/* -------------------------------- Tải lên ---------------------------------- */

/**
 * Tải một tệp lên Drive (multipart: metadata JSON + nội dung nhị phân).
 * @returns {{id: string, webViewLink: string}}
 */
async function uploadBuffer({ buffer, fileName, mime, folderId }) {
  const boundary = `ltl${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: fileName, parents: [folderId] });

  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, buffer, tail]);

  const res = await driveFetch(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Drive từ chối tệp (${res.status}): ${t.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Đường dẫn thư mục cho một tệp: <Tên trường>/<YYYY-MM>.
 * Tệp không gắn trường (học liệu dùng chung) ⇒ 'Dùng chung/<YYYY-MM>'.
 */
async function folderSegmentsFor(file) {
  const d = new Date(file.created_at || Date.now());
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  if (!file.school_id) return ['Dùng chung', ym];
  const s = await one('select name from schools where id = $1', [file.school_id]);
  return [s?.name || 'Trường khác', ym];
}

/** Tên tệp trên Drive: dễ đọc, có ngày giờ để không đè nhau. */
function driveNameFor(file) {
  const d = new Date(file.created_at || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const base = String(file.file_name || 'tep').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120);
  return `${stamp}_${base}`;
}

/* ----------------------------- Đồng bộ hàng đợi ---------------------------- */

/**
 * Đẩy các tệp chưa có trên Drive. Gọi từ job nền.
 * An toàn: lỗi một tệp không chặn các tệp còn lại; quá 5 lần lỗi thì bỏ qua
 * (xem cột drive_error để biết lý do).
 * @returns {{sent: number, failed: number, skipped: boolean}}
 */
export async function syncPendingFiles({ limit = 25 } = {}) {
  if (!driveEnabled()) return { sent: 0, failed: 0, skipped: true };

  const pending = await rows(
    `select id, storage_path, file_name, mime, size_bytes, school_id, created_at
       from files
      where drive_file_id is null and drive_attempts < 5
      order by created_at
      limit $1`,
    [limit]
  );
  if (!pending.length) return { sent: 0, failed: 0, skipped: false };

  let sent = 0;
  let failed = 0;

  for (const f of pending) {
    try {
      const abs = path.join(env.uploadDir, f.storage_path);
      const buffer = await fs.readFile(abs);

      const folderId = await ensureFolderPath(await folderSegmentsFor(f));
      const up = await uploadBuffer({
        buffer,
        fileName: driveNameFor(f),
        mime: f.mime || 'application/octet-stream',
        folderId,
      });

      await query(
        `update files
            set drive_file_id = $2, drive_link = $3, drive_synced_at = now(),
                drive_error = null, drive_attempts = drive_attempts + 1
          where id = $1`,
        [f.id, up.id, up.webViewLink || null]
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      await query(
        'update files set drive_attempts = drive_attempts + 1, drive_error = $2 where id = $1',
        [f.id, String(e.message).slice(0, 500)]
      ).catch(() => {});
      // Lỗi cấp tài khoản (token hỏng) ⇒ dừng cả lượt, khỏi đốt hạn mức.
      if (/access token|invalid_grant/i.test(e.message)) break;
    }
  }

  return { sent, failed, skipped: false };
}

/** Số liệu cho màn hình quản trị. */
export async function driveStatus() {
  const s = await one(
    `select count(*)::int                                            as total,
            count(*) filter (where drive_file_id is not null)::int   as synced,
            count(*) filter (where drive_file_id is null
                               and drive_attempts < 5)::int          as pending,
            count(*) filter (where drive_file_id is null
                               and drive_attempts >= 5)::int         as failed,
            max(drive_synced_at)                                     as last_synced_at
       from files`
  );
  const lastError = await one(
    `select drive_error, file_name from files
      where drive_error is not null order by created_at desc limit 1`
  );
  return {
    enabled: driveEnabled(),
    root_folder_id: env.drive.rootFolderId || null,
    ...s,
    last_error: lastError?.drive_error || null,
    last_error_file: lastError?.file_name || null,
  };
}

/** Kiểm tra kết nối lúc khởi động — không chặn nếu lỗi. */
export async function verifyDrive() {
  if (!driveEnabled()) {
    console.log('[drive] Chưa cấu hình Google Drive — ảnh chỉ lưu trên VPS.');
    return false;
  }
  if (!env.drive.rootFolderId) {
    console.warn('[drive] Thiếu GOOGLE_DRIVE_FOLDER_ID — bỏ qua đồng bộ Drive.');
    return false;
  }
  try {
    const res = await driveFetch(
      `${API_URL}/${env.drive.rootFolderId}?fields=id,name&supportsAllDrives=true`
    );
    if (!res.ok) throw new Error(`không mở được thư mục gốc (${res.status})`);
    const f = await res.json();
    console.log(`[drive] Sẵn sàng — đồng bộ vào thư mục "${f.name}".`);
    return true;
  } catch (e) {
    console.warn('[drive] Không kết nối được Google Drive:', e.message);
    return false;
  }
}
