/**
 * drive-auth.js — Lấy GOOGLE_DRIVE_REFRESH_TOKEN (chạy MỘT LẦN trên máy cá nhân).
 *
 * Cách chạy:
 *   cd server
 *   set GOOGLE_CLIENT_ID=...        (Windows; Linux/macOS dùng export)
 *   set GOOGLE_CLIENT_SECRET=...
 *   npm run drive:auth
 *
 * Script mở một máy chủ tạm ở http://localhost:5899, in ra đường dẫn để bạn bấm
 * đăng nhập Google. Cho phép xong, Google chuyển về localhost kèm mã, script đổi
 * mã lấy refresh token rồi in ra màn hình — chép vào .env trên VPS.
 *
 * Vì sao không dùng Service Account: tài khoản dịch vụ không có dung lượng Drive,
 * tải tệp vào thư mục chia sẻ của Gmail thường sẽ lỗi "do not have storage quota".
 * Refresh token cho phép tải lên đúng danh nghĩa tài khoản quản trị.
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = 5899;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    '\n[drive:auth] Thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET.\n\n' +
    'Lấy hai giá trị này ở Google Cloud Console:\n' +
    '  1. console.cloud.google.com → tạo project (ví dụ "LtL TeachOps")\n' +
    '  2. APIs & Services → Library → bật "Google Drive API"\n' +
    '  3. APIs & Services → Credentials → Create Credentials → OAuth client ID\n' +
    '     · Application type: Web application\n' +
    `     · Authorized redirect URI: ${REDIRECT_URI}\n` +
    '  4. Chép Client ID và Client secret rồi chạy lại lệnh này.\n'
  );
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',       // bắt buộc để Google trả refresh_token
  prompt: 'consent',            // luôn hỏi lại ⇒ chắc chắn có refresh_token mới
});

const page = (title, body, color = '#8a3f97') => `<!doctype html><html lang="vi"><meta charset="utf-8">
<body style="margin:0;padding:40px;font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#f6f2f8">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;
     box-shadow:0 6px 22px rgba(99,40,117,.12);border-top:5px solid ${color}">
<h2 style="margin:0 0 12px;color:${color}">${title}</h2>${body}</div></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page('Bạn đã từ chối cấp quyền', `<p>Google báo: <code>${error}</code></p>
        <p>Chạy lại <code>npm run drive:auth</code> nếu muốn thử lại.</p>`, '#ef4444'));
    console.error('\n[drive:auth] Bị từ chối:', error);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Thiếu mã uỷ quyền');
    return;
  }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const data = await r.json();

    if (!r.ok || !data.refresh_token) {
      throw new Error(data.error_description || data.error || 'Google không trả refresh_token');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page('Đã lấy được refresh token ✅',
        '<p>Quay lại cửa sổ dòng lệnh để chép giá trị vào file <code>.env</code>.</p>' +
        '<p style="color:#857e9e;font-size:13px">Có thể đóng tab này.</p>'));

    console.log(
      '\n============================================================\n' +
      '  ĐÃ LẤY ĐƯỢC REFRESH TOKEN — chép 3 dòng sau vào .env trên VPS\n' +
      '============================================================\n\n' +
      `GOOGLE_CLIENT_ID=${clientId}\n` +
      `GOOGLE_CLIENT_SECRET=${clientSecret}\n` +
      `GOOGLE_DRIVE_REFRESH_TOKEN=${data.refresh_token}\n\n` +
      'Ứng dụng tự tạo thư mục "LtL TeachOps — Ảnh & Video" trong Drive của bạn\n' +
      '(quyền drive.file chỉ ghi được vào thư mục do chính ứng dụng tạo).\n' +
      'Cách dễ hơn: Admin vào app → Lưu trữ Drive → Kết nối, không cần chạy script này.\n\n' +
      'GIỮ KÍN refresh token — ai có nó là vào được các tệp ứng dụng đã tải lên.\n' +
      '============================================================\n'
    );
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page('Đổi mã thất bại', `<p>${e.message}</p>`, '#ef4444'));
    console.error('\n[drive:auth] Lỗi:', e.message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 300);
  }
});

server.listen(PORT, () => {
  console.log(
    '\n[drive:auth] Mở đường dẫn sau trong trình duyệt, đăng nhập bằng TÀI KHOẢN\n' +
    '             QUẢN TRỊ CHÍNH (tài khoản sẽ chứa ảnh trên Drive):\n\n' +
    authUrl + '\n\n' +
    '             Đang chờ Google chuyển về…  (Ctrl+C để huỷ)\n'
  );
});
