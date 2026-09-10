/**
 * mailer.js — Gửi email tài khoản mới & đặt lại mật khẩu.
 *
 * Chưa cấu hình SMTP ⇒ KHÔNG ném lỗi: ghi log và trả { sent:false }, để Admin
 * vẫn tạo được tài khoản rồi đọc mật khẩu tạm ngay trên màn hình. Phù hợp giai
 * đoạn chạy thử trước khi công ty cấp tài khoản SMTP.
 */
import nodemailer from 'nodemailer';
import env from '../env.js';

let transporter = null;

function getTransporter() {
  if (!env.mailEnabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell(title, bodyHtml) {
  return `<!doctype html><html lang="vi"><body style="margin:0;padding:24px;background:#f6f2f8;
  font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1e1b2e">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;
       box-shadow:0 6px 22px rgba(99,40,117,.12)">
    <div style="background:linear-gradient(135deg,#ee6c98,#a94f9f 50%,#6f3fa2);padding:22px 24px;color:#fff">
      <div style="font-size:18px;font-weight:700">LtL TeachOps</div>
      <div style="font-size:12px;opacity:.9">Learn to Leap · Quản lý vận hành giáo viên</div>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 14px;font-size:17px">${esc(title)}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;background:#faf7fb;font-size:11.5px;color:#857e9e">
      Email tự động từ hệ thống LtL TeachOps — vui lòng không trả lời thư này.
    </div>
  </div></body></html>`;
}

async function send({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP chưa cấu hình — bỏ qua email "${subject}" gửi tới ${to}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await t.sendMail({ from: env.smtp.from, to, subject, html, text });
    return { sent: true };
  } catch (e) {
    console.error('[mailer] Gửi email thất bại:', e.message);
    return { sent: false, reason: e.message };
  }
}

/** Email cấp tài khoản mới kèm mật khẩu tạm. */
export function sendWelcome({ to, fullName, tempPassword, roleLabel }) {
  const url = env.appPublicUrl || '';
  const html = shell('Tài khoản của bạn đã được tạo', `
    <p style="margin:0 0 12px">Xin chào <b>${esc(fullName)}</b>,</p>
    <p style="margin:0 0 12px">Quản trị viên đã tạo tài khoản LtL TeachOps cho bạn với vai trò
       <b>${esc(roleLabel)}</b>. Thông tin đăng nhập:</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#857e9e">Email</td>
          <td style="padding:8px 0;font-weight:600">${esc(to)}</td></tr>
      <tr><td style="padding:8px 0;color:#857e9e">Mật khẩu tạm</td>
          <td style="padding:8px 0"><code style="background:#f6eef8;padding:5px 9px;border-radius:6px;
              font-size:15px;font-weight:700;letter-spacing:.5px">${esc(tempPassword)}</code></td></tr>
    </table>
    ${url ? `<p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;
       background:#8a3f97;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;
       font-weight:600">Đăng nhập ngay</a></p>` : ''}
    <p style="margin:0;color:#b0428f;font-size:13px"><b>Lưu ý:</b> hệ thống sẽ yêu cầu bạn
       đổi mật khẩu ngay ở lần đăng nhập đầu tiên.</p>`);

  return send({
    to,
    subject: 'LtL TeachOps — Tài khoản và mật khẩu tạm của bạn',
    html,
    text: `Xin chào ${fullName}, tài khoản LtL TeachOps của bạn: ${to} / mật khẩu tạm: ${tempPassword}. ` +
          `Vui lòng đổi mật khẩu ở lần đăng nhập đầu tiên. ${url}`,
  });
}

/** Email đặt lại mật khẩu. */
export function sendPasswordReset({ to, fullName, token }) {
  const link = env.appPublicUrl
    ? `${env.appPublicUrl}/dat-lai-mat-khau?token=${encodeURIComponent(token)}`
    : '';
  const html = shell('Đặt lại mật khẩu', `
    <p style="margin:0 0 12px">Xin chào <b>${esc(fullName)}</b>,</p>
    <p style="margin:0 0 16px">Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản
       <b>${esc(to)}</b>. Liên kết có hiệu lực trong <b>60 phút</b>.</p>
    ${link ? `<p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;
       background:#8a3f97;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;
       font-weight:600">Đặt lại mật khẩu</a></p>
    <p style="margin:0 0 12px;font-size:12px;color:#857e9e;word-break:break-all">
       Nếu nút không hoạt động, sao chép liên kết: ${esc(link)}</p>` : ''}
    <p style="margin:0;font-size:13px;color:#857e9e">Nếu bạn không yêu cầu, hãy bỏ qua email này —
       mật khẩu hiện tại vẫn giữ nguyên.</p>`);

  return send({ to, subject: 'LtL TeachOps — Đặt lại mật khẩu', html,
    text: `Đặt lại mật khẩu LtL TeachOps: ${link || '(chưa cấu hình đường dẫn ứng dụng)'}` });
}

/** Kiểm tra kết nối SMTP lúc khởi động (không chặn nếu lỗi). */
export async function verifyMailer() {
  const t = getTransporter();
  if (!t) {
    console.log('[mailer] SMTP chưa cấu hình — mật khẩu tạm sẽ hiển thị trên màn hình Admin.');
    return false;
  }
  try {
    await t.verify();
    console.log('[mailer] SMTP sẵn sàng:', env.smtp.host);
    return true;
  } catch (e) {
    console.warn('[mailer] Không kết nối được SMTP:', e.message);
    return false;
  }
}
