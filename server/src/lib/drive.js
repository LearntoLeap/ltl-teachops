/**
 * drive.js — Google Drive làm kho lưu trữ ảnh/video của tài khoản quản trị chính.
 *
 * XÁC THỰC: OAuth 2.0 refresh token (không dùng Service Account — tài khoản dịch vụ
 * không có dung lượng Drive riêng). Admin kết nối ngay trong app (Lưu trữ Drive →
 * Kết nối): đăng nhập Google, bấm Cho phép — không ai phải gửi mật khẩu cho ai.
 * Cấu hình trong app (bảng app_settings) ưu tiên hơn biến môi trường.
 *
 * PHẠM VI QUYỀN: drive.file — ứng dụng CHỈ thấy các tệp/thư mục do chính nó tạo,
 * không đọc được phần còn lại của Drive. Vì vậy thư mục gốc
 * "LtL TeachOps — Ảnh & Video" do ứng dụng tự tạo trong "Drive của tôi"
 * (thư mục người dùng tự tạo bằng tay thì ứng dụng không ghi vào được).
 *
 * LUỒNG:
 *   1. Đồng bộ: tệp mới (quá 2 phút, để bản ghi nghiệp vụ kịp gắn) được tải lên theo
 *      dạng resumable, đọc thẳng từ đĩa — video lớn không phải nạp cả vào RAM.
 *      Xếp thư mục: <Trường>/<YYYY-MM>/<Chấm công | Điểm danh | Thiết bị…>.
 *   2. Giải phóng VPS: ảnh/video hiện trường đã lên Drive quá N ngày ⇒ kiểm lại bản
 *      trên Drive còn nguyên (md5 khớp) rồi mới xoá bản gốc; ảnh giữ bản thu nhỏ.
 *      Học liệu, ảnh bìa, ảnh đại diện KHÔNG bị xoá khỏi VPS (cần mở nhanh / tải ZIP).
 *   3. Xem tệp đã chuyển: routes/files.js lấy từ Drive rồi chuyển tiếp (có Range cho video).
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import env from '../env.js';
import { one, rows, query } from '../db.js';
import { getSetting, patchSetting } from './settings.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const API_URL = 'https://www.googleapis.com/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_FOLDER_NAME = 'LtL TeachOps — Ảnh & Video';

/* ------------------------------- Cấu hình --------------------------------- */

/** Cấu hình hiệu lực: nhập trong app (CSDL) trước, biến môi trường sau. */
export async function driveConfig() {
  const s = (await getSetting('drive')) || {};
  return {
    source: s.client_id ? 'app' : env.drive.clientId ? 'env' : null,
    clientId: s.client_id || env.drive.clientId,
    clientSecret: s.client_secret || env.drive.clientSecret,
    refreshToken: s.refresh_token || (s.client_id ? '' : env.drive.refreshToken),
    account: s.account || null,                 // { email, name }
    rootFolderId: s.root_folder_id || null,
    keepLocalDays: Number.isInteger(s.keep_local_days) ? s.keep_local_days : env.drive.keepLocalDays,
    offload: s.offload !== false,
  };
}

export const saveDriveSettings = (patch, userId) => patchSetting('drive', patch, userId);

/** Đã đủ cấu hình + đã kết nối tài khoản để đồng bộ chưa? */
export async function driveEnabled() {
  const c = await driveConfig();
  return !!(c.clientId && c.clientSecret && c.refreshToken);
}

/* --------------------------- Access token (có cache) ------------------------ */
let _token = null;          // { value, expiresAt, rt }

async function getAccessToken() {
  const c = await driveConfig();
  if (!c.refreshToken) throw new Error('Chưa kết nối tài khoản Google Drive.');
  if (_token && _token.rt === c.refreshToken && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant = token bị thu hồi / đổi mật khẩu Google / app ở chế độ Testing quá 7 ngày.
    const hint = data.error === 'invalid_grant' ? ' — cần Kết nối lại Google Drive trong app' : '';
    throw new Error(`Google từ chối cấp access token: ${data.error || res.status}${hint}`);
  }
  _token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, rt: c.refreshToken };
  return _token.value;
}

/** Gọi Drive API kèm access token, tự thử lại một lần nếu token vừa hết hạn. */
async function driveFetch(url, opts = {}, retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    _token = null;
    return driveFetch(url, opts, false);
  }
  return res;
}

/* ------------------------------ OAuth (kết nối) ----------------------------- */

export function buildAuthUrl({ clientId, redirectUri, state }) {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',     // bắt buộc để Google trả refresh_token
    prompt: 'consent',          // luôn hỏi lại ⇒ chắc chắn có refresh_token mới
    include_granted_scopes: 'true',
    state,
  })}`;
}

/** Đổi mã uỷ quyền lấy token + thông tin tài khoản Google vừa đăng nhập. */
export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || 'Google không trả refresh token');
  }
  const about = await fetch(`${API_URL}/about?fields=user(emailAddress,displayName)`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const user = about.ok ? (await about.json()).user : null;
  return {
    refreshToken: data.refresh_token,
    account: user ? { email: user.emailAddress, name: user.displayName } : null,
  };
}

export async function revokeToken(token) {
  if (!token) return;
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  _token = null;
}

/* ------------------------------- Thư mục ----------------------------------- */

async function findFolder(name, parentId) {
  const q = [
    `name = '${String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ');
  const res = await driveFetch(`${API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  if (!res.ok) throw new Error(`Không tra cứu được thư mục Drive (${res.status})`);
  return (await res.json()).files?.[0]?.id || null;
}

async function createFolder(name, parentId) {
  const res = await driveFetch(`${API_URL}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),   // không có cha ⇒ nằm ở "Drive của tôi"
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Không tạo được thư mục "${name}" trên Drive: ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()).id;
}

/** Thư mục gốc do ứng dụng tạo; tạo lại nếu đã bị xoá / đưa vào thùng rác. */
export async function ensureRootFolder() {
  const c = await driveConfig();
  if (c.rootFolderId) {
    const res = await driveFetch(`${API_URL}/files/${c.rootFolderId}?fields=id,trashed`);
    if (res.ok && !(await res.json()).trashed) return c.rootFolderId;
  }
  const id = await createFolder(ROOT_FOLDER_NAME, null);
  await saveDriveSettings({ root_folder_id: id });
  return id;
}

/** Bảo đảm cây thư mục tồn tại dưới thư mục gốc, trả id thư mục lá (có ghi nhớ). */
async function ensureFolderPath(rootId, segments) {
  let parentId = rootId;
  const walked = [];
  for (const raw of segments) {
    const name = String(raw || '').trim().replace(/[/\\]/g, '-') || 'Khác';
    walked.push(name);
    const cacheKey = `${rootId}:${walked.join('/')}`;

    const cached = await one('select folder_id from drive_folders where path = $1', [cacheKey]);
    if (cached) { parentId = cached.folder_id; continue; }

    const id = (await findFolder(name, parentId)) || (await createFolder(name, parentId));
    await query('insert into drive_folders (path, folder_id) values ($1, $2) on conflict (path) do nothing', [cacheKey, id]);
    parentId = id;
  }
  return parentId;
}

/* ------------------------- Ngữ cảnh nghiệp vụ của tệp ------------------------ */

/**
 * Tệp này thuộc nghiệp vụ nào — để xếp thư mục và đặt tên dễ tra cứu trên Drive.
 * Thứ tự ưu tiên theo cột `o` (một tệp chỉ thuộc một nghiệp vụ trong thực tế).
 */
function contextFor(fileId) {
  return one(
    `select * from (
       select 1 as o, 'Chấm công' as kind, s.school_id, s.session_date as day,
              c.name as label, u.full_name as person
         from timesheets t
         join schedules s on s.id = t.schedule_id
         join classes c on c.id = s.class_id
         join users u on u.id = t.user_id
        where $1 in (t.check_in_photo_id, t.check_out_photo_id, t.check_in_selfie_id, t.check_out_selfie_id)
       union all
       select 2, 'Điểm danh', a.school_id, s.session_date, c.name, u.full_name
         from attendance_photos ap
         join attendance a on a.id = ap.attendance_id
         join schedules s on s.id = a.schedule_id
         join classes c on c.id = a.class_id
         join users u on u.id = a.marked_by
        where ap.file_id = $1
       union all
       select 3, 'Kiểm kê thiết bị', d.school_id, d.check_date, r.name, u.full_name
         from device_check_photos p
         join device_checks d on d.id = p.check_id
         join stem_rooms r on r.id = d.room_id
         join users u on u.id = d.user_id
        where p.file_id = $1
       union all
       select 4, 'Sự cố thiết bị', i.school_id, i.created_at::date, i.device_name, u.full_name
         from device_issue_photos p
         join device_issues i on i.id = p.issue_id
         join users u on u.id = i.reported_by
        where p.file_id = $1
       union all
       select 5, 'Góp ý', f.school_id, f.created_at::date, null, u.full_name
         from feedback_photos p
         join feedback f on f.id = p.feedback_id
         join users u on u.id = f.created_by
        where p.file_id = $1
       union all
       select 6, 'Học liệu', m.school_id, m.created_at::date, m.title, null
         from materials m
        where m.cover_file_id = $1
           or exists (select 1 from material_versions v where v.material_id = m.id and v.file_id = $1)
     ) x
     order by o
     limit 1`,
    [fileId]
  );
}

const clean = (s, max = 60) => String(s || '').replace(/[/\\?%*:|"<>\r\n\t]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, max);

/** Thư mục + tên tệp trên Drive, ví dụ:
 *  THCS Xuân Tâm / 2026-09 / Điểm danh / 20260912-0815_6A1_Nguyễn Văn An_IMG_1234.jpg */
async function drivePlacement(file) {
  const ctx = await contextFor(file.id);
  const at = new Date(file.created_at);
  const p = (n) => String(n).padStart(2, '0');
  const day = ctx?.day ? new Date(ctx.day) : at;
  const ym = `${day.getFullYear()}-${p(day.getMonth() + 1)}`;

  const schoolId = ctx?.school_id || file.school_id;
  const school = schoolId ? await one('select name from schools where id = $1', [schoolId]) : null;
  const segments = [school?.name || 'Dùng chung', ym, ctx?.kind || 'Khác'];

  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  const name = [stamp, clean(ctx?.label, 40), clean(ctx?.person, 40), clean(file.file_name, 100) || 'tep']
    .filter(Boolean).join('_');
  return { segments, name };
}

/* -------------------------------- Tải lên ---------------------------------- */

/**
 * Tải lên dạng resumable, đọc luồng từ đĩa (video vài trăm MB không chiếm RAM).
 * @returns {{id, webViewLink, md5Checksum, size}}
 */
async function uploadFromDisk({ abs, size, name, mime, folderId }) {
  const init = await driveFetch(`${UPLOAD_URL}?uploadType=resumable&fields=id,webViewLink,md5Checksum,size`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!init.ok) {
    const t = await init.text().catch(() => '');
    throw new Error(`Drive không mở được phiên tải lên (${init.status}): ${t.slice(0, 200)}`);
  }
  const session = init.headers.get('location');
  if (!session) throw new Error('Drive không trả địa chỉ phiên tải lên.');

  const put = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
    body: createReadStream(abs),
    duplex: 'half',
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error(`Drive từ chối tệp (${put.status}): ${t.slice(0, 200)}`);
  }
  return put.json();
}

const absOf = (f) => path.join(env.uploadDir, f.storage_path);

/**
 * Đẩy các tệp chưa có trên Drive. Lỗi một tệp không chặn tệp khác; quá 5 lần lỗi
 * thì bỏ qua (xem cột drive_error). Lỗi cấp tài khoản ⇒ dừng cả lượt.
 * @returns {{sent, failed, skipped}}
 */
let _syncing = false;
let _offloading = false;

export async function syncPendingFiles({ limit = 25 } = {}) {
  // Job nền và nút "Đồng bộ ngay" có thể chạy trùng lúc ⇒ không đẩy một tệp hai lần.
  if (_syncing) return { sent: 0, failed: 0, skipped: true, busy: true };
  _syncing = true;
  try {
    return await syncBatch(limit);
  } finally {
    _syncing = false;
  }
}

async function syncBatch(limit) {
  if (!(await driveEnabled())) return { sent: 0, failed: 0, skipped: true };

  const pending = await rows(
    `select id, storage_path, file_name, mime, size_bytes, school_id, created_at
       from files
      where drive_file_id is null and drive_attempts < 5 and local_deleted_at is null
        and created_at < now() - interval '2 minutes'
      order by created_at
      limit $1`,
    [limit]
  );
  if (!pending.length) return { sent: 0, failed: 0, skipped: false };

  const rootId = await ensureRootFolder();
  let sent = 0;
  let failed = 0;
  for (const f of pending) {
    try {
      const abs = absOf(f);
      const st = await fs.stat(abs);
      const { segments, name } = await drivePlacement(f);
      const folderId = await ensureFolderPath(rootId, segments);
      const up = await uploadFromDisk({ abs, size: st.size, name, mime: f.mime || 'application/octet-stream', folderId });
      await query(
        `update files
            set drive_file_id = $2, drive_link = $3, drive_md5 = $4, drive_synced_at = now(),
                drive_error = null, drive_attempts = drive_attempts + 1
          where id = $1`,
        [f.id, up.id, up.webViewLink || null, up.md5Checksum || null]
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      await query(
        'update files set drive_attempts = drive_attempts + 1, drive_error = $2 where id = $1',
        [f.id, String(e.message).slice(0, 500)]
      ).catch(() => {});
      if (/access token|invalid_grant|Chưa kết nối/i.test(e.message)) break;
    }
  }
  return { sent, failed, skipped: false };
}

/* --------------------------- Giải phóng dung lượng VPS --------------------------- */

const md5OfFile = (abs) => new Promise((resolve, reject) => {
  const h = crypto.createHash('md5');
  createReadStream(abs).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

/**
 * Xoá bản gốc trên VPS của ảnh/video hiện trường đã lên Drive quá `keepLocalDays` ngày.
 * Chỉ xoá khi Drive xác nhận tệp còn đó, chưa vào thùng rác và md5 khớp bản trên đĩa.
 * `ensureThumb(file)` (từ storage.js) tạo sẵn ảnh thu nhỏ để danh sách vẫn hiện nhanh.
 * @returns {{freed, bytes, requeued}}
 */
export async function offloadLocalCopies(opts = {}) {
  if (_offloading) return { freed: 0, bytes: 0, requeued: 0, busy: true };
  _offloading = true;
  try {
    return await offloadBatch(opts);
  } finally {
    _offloading = false;
  }
}

async function offloadBatch({ limit = 100, ensureThumb } = {}) {
  const c = await driveConfig();
  if (!c.offload || !(await driveEnabled())) return { freed: 0, bytes: 0, requeued: 0 };

  const list = await rows(
    `select f.id, f.storage_path, f.mime, f.size_bytes, f.drive_file_id, f.drive_md5
       from files f
      where f.drive_file_id is not null and f.local_deleted_at is null
        and f.created_at < now() - make_interval(days => $1)
        and (f.mime like 'image/%' or f.mime like 'video/%')
        and not exists (select 1 from material_versions v where v.file_id = f.id)
        and not exists (select 1 from materials m where m.cover_file_id = f.id)
        and not exists (select 1 from users u where u.avatar_file_id = f.id)
        and not exists (select 1 from solution_items si where si.file_id = f.id)
      order by f.created_at
      limit $2`,
    [Math.max(0, c.keepLocalDays), limit]
  );

  let freed = 0;
  let bytes = 0;
  let requeued = 0;
  for (const f of list) {
    const abs = absOf(f);
    try {
      const res = await driveFetch(`${API_URL}/files/${f.drive_file_id}?fields=id,md5Checksum,size,trashed`);
      if (res.status === 404 || (res.ok && (await res.clone().json()).trashed)) {
        // Bản trên Drive đã mất ⇒ đẩy lại từ VPS ở lượt đồng bộ sau, tuyệt đối không xoá.
        await query(
          `update files set drive_file_id = null, drive_link = null, drive_md5 = null,
                  drive_synced_at = null, drive_attempts = 0 where id = $1`, [f.id]
        );
        requeued += 1;
        continue;
      }
      if (!res.ok) throw new Error(`Drive trả ${res.status}`);
      const meta = await res.json();
      const localMd5 = await md5OfFile(abs);
      if (!meta.md5Checksum || meta.md5Checksum !== localMd5) {
        throw new Error('md5 trên Drive không khớp bản trên VPS — giữ nguyên bản gốc');
      }
      if (ensureThumb && f.mime.startsWith('image/')) await ensureThumb(f);
      await fs.unlink(abs);
      await query('update files set local_deleted_at = now(), drive_md5 = $2 where id = $1', [f.id, meta.md5Checksum]);
      freed += 1;
      bytes += Number(f.size_bytes || 0);
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Đĩa đã mất bản gốc từ trước nhưng Drive còn ⇒ coi như đã chuyển.
        await query('update files set local_deleted_at = now() where id = $1', [f.id]);
        continue;
      }
      await query('update files set drive_error = $2 where id = $1', [f.id, `Dọn VPS: ${String(e.message).slice(0, 400)}`]).catch(() => {});
      if (/access token|invalid_grant/i.test(e.message)) break;
    }
  }
  return { freed, bytes, requeued };
}

/* ------------------------------ Đọc tệp từ Drive ------------------------------ */

/** Lấy nội dung tệp từ Drive (chuyển tiếp Range để tua video). Trả Response của fetch. */
export async function fetchFromDrive(driveFileId, range) {
  return driveFetch(`${API_URL}/files/${driveFileId}?alt=media`, { headers: range ? { Range: range } : {} });
}

/* ------------------------------- Tình trạng -------------------------------- */

export async function driveStatus() {
  const c = await driveConfig();
  const s = await one(
    `select count(*)::int                                                         as total,
            count(*) filter (where drive_file_id is not null)::int                as synced,
            count(*) filter (where drive_file_id is null and drive_attempts < 5
                               and local_deleted_at is null)::int                 as pending,
            count(*) filter (where drive_file_id is null and drive_attempts >= 5)::int as failed,
            count(*) filter (where local_deleted_at is not null)::int             as offloaded,
            coalesce(sum(size_bytes) filter (where local_deleted_at is not null), 0)::bigint as offloaded_bytes,
            coalesce(sum(size_bytes) filter (where local_deleted_at is null), 0)::bigint     as local_bytes,
            count(*) filter (where mime like 'video/%')::int                      as videos,
            max(drive_synced_at)                                                  as last_synced_at
       from files`
  );
  const lastError = await one(
    `select drive_error, file_name from files where drive_error is not null
      order by coalesce(drive_synced_at, created_at) desc limit 1`
  );
  return {
    configured: !!(c.clientId && c.clientSecret),
    connected: !!(c.clientId && c.clientSecret && c.refreshToken),
    source: c.source,
    client_id: c.clientId ? `${c.clientId.slice(0, 12)}…${c.clientId.slice(-24)}` : null,
    account: c.account,
    root_folder_id: c.rootFolderId,
    root_folder_link: c.rootFolderId ? `https://drive.google.com/drive/folders/${c.rootFolderId}` : null,
    keep_local_days: c.keepLocalDays,
    offload: c.offload,
    ...s,
    offloaded_bytes: Number(s.offloaded_bytes),
    local_bytes: Number(s.local_bytes),
    last_error: lastError?.drive_error || null,
    last_error_file: lastError?.file_name || null,
  };
}

/** Kiểm tra kết nối lúc khởi động — không bao giờ làm hỏng quá trình khởi động. */
export async function verifyDrive() {
  try {
    if (!(await driveEnabled())) {
      console.log('[drive] Chưa kết nối Google Drive — ảnh/video chỉ lưu trên VPS.');
      return false;
    }
    await ensureRootFolder();
    const c = await driveConfig();
    console.log(`[drive] Sẵn sàng — đồng bộ vào "${ROOT_FOLDER_NAME}"${c.account ? ` của ${c.account.email}` : ''}.`);
    return true;
  } catch (e) {
    console.warn('[drive] Không kết nối được Google Drive:', e.message);
    return false;
  }
}
