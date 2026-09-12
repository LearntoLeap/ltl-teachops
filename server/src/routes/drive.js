/**
 * routes/drive.js — Kết nối & quản lý Google Drive làm kho ảnh/video (CHỈ Admin).
 *
 * Luồng kết nối (không ai phải gửi mật khẩu Google cho ai):
 *   1. Admin dán Client ID + Client secret của OAuth client (Google Cloud Console).
 *   2. Bấm "Kết nối" ⇒ GET /api/drive/connect trả đường dẫn đăng nhập Google.
 *   3. Admin đăng nhập TÀI KHOẢN SẼ CHỨA ẢNH, bấm Cho phép ⇒ Google chuyển về
 *      /api/drive/oauth/callback kèm mã ⇒ server đổi lấy refresh token, lưu vào CSDL,
 *      tạo thư mục "LtL TeachOps — Ảnh & Video" rồi đưa Admin về lại màn hình app.
 *
 * Bảo vệ dữ liệu: khi đã có tệp chỉ còn nằm trên Drive (bản gốc VPS đã dọn), KHÔNG cho
 * đổi sang OAuth client hoặc tài khoản Google khác — nếu không app sẽ mất quyền đọc
 * các tệp đó (quyền drive.file gắn với đúng ứng dụng + đúng tài khoản đã tạo tệp).
 */
import jwt from 'jsonwebtoken';
import env from '../env.js';
import { one } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict } from '../lib/errors.js';
import { str, int, bool } from '../lib/validate.js';
import {
  driveConfig, driveStatus, saveDriveSettings, buildAuthUrl, exchangeCode, revokeToken,
  ensureRootFolder, syncPendingFiles, offloadLocalCopies,
} from '../lib/drive.js';
import { getThumbPath } from '../lib/storage.js';

const adminOnly = { preHandler: requirePerm('drive.manage') };

/** Redirect URI phải khớp TUYỆT ĐỐI với giá trị khai trong Google Cloud Console. */
function redirectUri(req) {
  const base = env.apiPublicUrl || `${req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${base}/api/drive/oauth/callback`;
}

/** Trang app để đưa Admin quay về sau khi Google xử lý xong. */
function appPage(query) {
  const base = env.appPublicUrl || env.corsOrigins[0] || '';
  return `${base}/luu-tru-drive?${new URLSearchParams(query)}`;
}

const offloadedCount = async () =>
  (await one('select count(*)::int as n from files where local_deleted_at is not null')).n;

export default async function routes(app) {
  /* GET /api/drive — tình trạng + cấu hình (không bao giờ trả secret/token). */
  app.get('/api/drive', adminOnly, async (req) => ({
    ...(await driveStatus()),
    redirect_uri: redirectUri(req),
    max_video_mb: Math.round(env.maxVideoBytes / 1024 / 1024),
  }));

  /* PUT /api/drive/config — {client_id, client_secret}: OAuth client từ Google Cloud. */
  app.put('/api/drive/config', adminOnly, async (req) => {
    const clientId = str(req.body?.client_id, 'Client ID', { required: true, max: 300 });
    const clientSecret = str(req.body?.client_secret, 'Client secret', { required: true, max: 300 });
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw badRequest('Client ID không đúng dạng — phải kết thúc bằng ".apps.googleusercontent.com".');
    }

    const cur = await driveConfig();
    if (cur.clientId && cur.clientId !== clientId && (await offloadedCount())) {
      throw conflict(
        'Đang có ảnh/video chỉ còn lưu trên Drive qua OAuth client hiện tại — đổi sang client khác ' +
        'app sẽ không đọc được các tệp đó. Hãy giữ nguyên Client ID đang dùng.'
      );
    }
    const changed = cur.clientId !== clientId;
    await saveDriveSettings({
      client_id: clientId,
      client_secret: clientSecret,
      // Refresh token cấp cho client cũ không dùng được với client mới.
      ...(changed ? { refresh_token: null } : {}),
    }, req.user.id);

    audit(req, {
      action: 'update', entity: 'app_settings', entityId: 'drive',
      summary: `Cập nhật OAuth client Google Drive (${clientId.slice(0, 12)}…)`,
    });
    return driveStatus();
  });

  /* GET /api/drive/connect — trả đường dẫn đăng nhập Google (client tự chuyển trang). */
  app.get('/api/drive/connect', adminOnly, async (req) => {
    const c = await driveConfig();
    if (!c.clientId || !c.clientSecret) throw badRequest('Nhập Client ID và Client secret trước khi kết nối.');
    const state = jwt.sign({ sub: req.user.id, typ: 'drive-oauth' }, env.jwtSecret, { expiresIn: '15m' });
    return { url: buildAuthUrl({ clientId: c.clientId, redirectUri: redirectUri(req), state }) };
  });

  /* GET /api/drive/oauth/callback — CÔNG KHAI: Google chuyển trình duyệt về đây. */
  app.get('/api/drive/oauth/callback', async (req, reply) => {
    const back = (q) => reply.redirect(appPage(q));
    const { code, state, error } = req.query || {};
    if (error) return back({ ket_noi: 'loi', ly_do: error === 'access_denied' ? 'Bạn đã bấm Từ chối trên Google.' : error });

    let payload;
    try {
      payload = jwt.verify(String(state || ''), env.jwtSecret);
    } catch {
      return back({ ket_noi: 'loi', ly_do: 'Phiên kết nối đã hết hạn (quá 15 phút) — bấm Kết nối lại.' });
    }
    const admin = payload?.typ === 'drive-oauth'
      ? await one(`select id, email from users where id = $1 and role = 'admin' and is_active`, [payload.sub])
      : null;
    if (!admin || !code) return back({ ket_noi: 'loi', ly_do: 'Yêu cầu kết nối không hợp lệ.' });

    try {
      const c = await driveConfig();
      const got = await exchangeCode({
        code: String(code), clientId: c.clientId, clientSecret: c.clientSecret, redirectUri: redirectUri(req),
      });
      const prevEmail = c.account?.email;
      if (prevEmail && got.account?.email && prevEmail !== got.account.email && (await offloadedCount())) {
        await revokeToken(got.refreshToken);
        return back({
          ket_noi: 'loi',
          ly_do: `Tài khoản ${got.account.email} khác tài khoản đang giữ ảnh/video (${prevEmail}). ` +
            'Hãy kết nối lại bằng đúng tài khoản cũ.',
        });
      }
      // Đổi tài khoản khi chưa có tệp nào chỉ nằm trên Drive ⇒ bắt đầu thư mục gốc mới.
      const accountChanged = prevEmail && got.account?.email && prevEmail !== got.account.email;
      await saveDriveSettings({
        refresh_token: got.refreshToken,
        account: got.account,
        ...(accountChanged ? { root_folder_id: null } : {}),
      }, admin.id);
      await ensureRootFolder();

      audit({ user: admin, headers: req.headers, ip: req.ip }, {
        action: 'update', entity: 'app_settings', entityId: 'drive',
        summary: `Kết nối Google Drive với tài khoản ${got.account?.email || '(không rõ)'}`,
      });
      return back({ ket_noi: 'ok' });
    } catch (e) {
      req.log.warn({ err: e }, 'Kết nối Google Drive thất bại');
      return back({ ket_noi: 'loi', ly_do: String(e.message).slice(0, 200) });
    }
  });

  /* POST /api/drive/disconnect — thu hồi quyền; tệp đã lên Drive vẫn còn nguyên trên Drive. */
  app.post('/api/drive/disconnect', adminOnly, async (req) => {
    const c = await driveConfig();
    await revokeToken(c.refreshToken);
    await saveDriveSettings({ refresh_token: null }, req.user.id);
    audit(req, {
      action: 'update', entity: 'app_settings', entityId: 'drive',
      summary: `Ngắt kết nối Google Drive (${c.account?.email || 'không rõ tài khoản'})`,
    });
    return driveStatus();
  });

  /* PATCH /api/drive/settings — {keep_local_days, offload}. */
  app.patch('/api/drive/settings', adminOnly, async (req) => {
    const b = req.body || {};
    const patch = {};
    if ('keep_local_days' in b) {
      patch.keep_local_days = int(b.keep_local_days, 'Số ngày giữ bản gốc trên VPS', { required: true, min: 0, max: 365 });
    }
    if ('offload' in b) patch.offload = bool(b.offload, 'offload', { required: true });
    if (!Object.keys(patch).length) throw badRequest('Không có thông tin nào để cập nhật.');
    await saveDriveSettings(patch, req.user.id);
    audit(req, {
      action: 'update', entity: 'app_settings', entityId: 'drive',
      summary: `Cài đặt lưu trữ Drive: ${JSON.stringify(patch)}`,
    });
    return driveStatus();
  });

  /* POST /api/drive/sync — đẩy ngay + dọn bản gốc đủ hạn, không chờ job nền. */
  app.post('/api/drive/sync', adminOnly, async (req) => {
    const sync = await syncPendingFiles({ limit: 100 });
    const offload = await offloadLocalCopies({ limit: 200, ensureThumb: (f) => getThumbPath(f, 480) });
    audit(req, {
      action: 'export', entity: 'files',
      summary: `Đồng bộ Drive thủ công: đẩy ${sync.sent} tệp` +
        `${sync.failed ? ` (lỗi ${sync.failed})` : ''}, giải phóng ${offload.freed} tệp trên VPS`,
    });
    return { sync, offload, status: await driveStatus() };
  });
}
