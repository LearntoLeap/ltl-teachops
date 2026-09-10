/**
 * routes/auth.js — Xác thực: đăng nhập, làm mới token, đổi/đặt lại mật khẩu.
 * Hợp đồng API: docs/API.md mục 1.
 *
 * Các route login/refresh/forgot-password/reset-password nằm trong PUBLIC_PATHS
 * (app.js) — không có req.user; me/change-password/logout đã qua authenticate.
 */
import { one, rows, query } from '../db.js';
import { unauthorized, badRequest } from '../lib/errors.js';
import {
  verifyPassword,
  hashPassword,
  checkPasswordStrength,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  createPasswordReset,
  consumePasswordReset,
  touchLastLogin,
} from '../lib/auth.js';
import { permissionsFor } from '../lib/rbac.js';
import { visibleSchoolIds } from '../lib/scope.js';
import { audit } from '../lib/audit.js';
import { sendPasswordReset } from '../lib/mailer.js';
import { str, email } from '../lib/validate.js';

// Băm giả để so sánh khi email không tồn tại — thời gian phản hồi giống nhau,
// không lộ email nào có trong hệ thống qua timing.
const DUMMY_HASH = await hashPassword('khong-phai-mat-khau-that');

/** Thông tin user gửi cho frontend — KHÔNG bao giờ kèm password_hash. */
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    phone: u.phone,
    role: u.role,
    avatar_file_id: u.avatar_file_id,
    must_change_password: u.must_change_password === true,
    permissions: permissionsFor(u.role),
  };
}

/** Ngữ cảnh thiết bị cho refresh token. */
const tokenMeta = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

const SCHOOL_COLS =
  'id, code, name, address, province, lat, lng, gps_radius_m, grace_minutes, device_slots, contact_name, contact_phone, is_active';

export default async function routes(app) {
  /* ----------------------------- Đăng nhập ------------------------------- */
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      const body = req.body || {};
      const em = email(body.email, 'Email', { required: true });
      const password = str(body.password, 'Mật khẩu', { required: true, max: 200, trim: false });

      const u = await one('select * from users where email = $1', [em]);
      // Luôn chạy verify (kể cả khi không có user) để không phân biệt hai trường hợp.
      const ok = await verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
      if (!u || !ok) throw unauthorized('Email hoặc mật khẩu không đúng.');
      if (!u.is_active) throw unauthorized('Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.');

      const accessToken = signAccessToken(u);
      const refreshToken = await issueRefreshToken(u.id, tokenMeta(req));
      touchLastLogin(u.id);

      req.user = u; // route công khai chưa có req.user — gán để nhật ký ghi đúng người
      audit(req, {
        action: 'login',
        entity: 'users',
        entityId: u.id,
        summary: `Đăng nhập: ${u.email}`,
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: publicUser(u),
        must_change_password: u.must_change_password === true,
      };
    }
  );

  /* ------------------------- Làm mới cặp token --------------------------- */
  app.post('/api/auth/refresh', async (req) => {
    const raw = str(req.body?.refresh_token, 'refresh_token', { required: true, max: 200 });

    // rotateRefreshToken thu hồi token cũ và phát token mới (xoay vòng).
    const { user: u, refreshToken } = await rotateRefreshToken(raw, tokenMeta(req));

    return {
      access_token: signAccessToken(u),
      refresh_token: refreshToken,
      user: publicUser(u),
      must_change_password: u.must_change_password === true,
    };
  });

  /* ------------------------------ Đăng xuất ------------------------------ */
  app.post('/api/auth/logout', async (req, reply) => {
    const raw = str(req.body?.refresh_token, 'refresh_token', { max: 200 });
    await revokeRefreshToken(raw);
    return reply.code(204).send();
  });

  /* ----------------------------- Hồ sơ của tôi --------------------------- */
  app.get('/api/auth/me', async (req) => {
    const u = await one(
      `select id, email, full_name, phone, role, must_change_password,
              avatar_file_id, last_login_at, created_at
         from users where id = $1`,
      [req.user.id]
    );

    // Danh sách trường trong phạm vi: admin = mọi trường active;
    // manager = user_schools; teacher/assistant = trường có lớp/buổi được phân công.
    const ids = await visibleSchoolIds(req.user);
    let schools;
    if (ids === null) {
      schools = await rows(`select ${SCHOOL_COLS} from schools where is_active order by name`);
    } else if (!ids.length) {
      schools = [];
    } else {
      schools = await rows(`select ${SCHOOL_COLS} from schools where id = any($1) order by name`, [ids]);
    }

    return {
      ...publicUser(u),
      last_login_at: u.last_login_at,
      created_at: u.created_at,
      schools,
    };
  });

  /* ---------------------------- Đổi mật khẩu ----------------------------- */
  app.post('/api/auth/change-password', async (req) => {
    const body = req.body || {};
    const current = str(body.current_password, 'Mật khẩu hiện tại', { required: true, max: 200, trim: false });
    const nextPw = str(body.new_password, 'Mật khẩu mới', { required: true, max: 200, trim: false });

    const u = await one('select * from users where id = $1', [req.user.id]);
    const ok = await verifyPassword(current, u.password_hash);
    if (!ok) throw badRequest('Mật khẩu hiện tại không đúng.');

    const weak = checkPasswordStrength(nextPw);
    if (weak) throw badRequest(weak);

    const hash = await hashPassword(nextPw);
    await query('update users set password_hash = $1, must_change_password = false where id = $2', [
      hash,
      u.id,
    ]);

    // Thu hồi mọi phiên cũ rồi phát cặp token MỚI — phiên hiện tại không bị đá ra.
    await revokeAllUserTokens(u.id);
    const fresh = { ...u, must_change_password: false };
    const accessToken = signAccessToken(fresh);
    const refreshToken = await issueRefreshToken(u.id, tokenMeta(req));

    audit(req, {
      action: 'update',
      entity: 'users',
      entityId: u.id,
      summary: 'Đổi mật khẩu (tự thao tác).',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: publicUser(fresh),
      must_change_password: false,
    };
  });

  /* --------------------------- Quên mật khẩu ----------------------------- */
  app.post(
    '/api/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const em = email(req.body?.email, 'Email', { required: true });

      const u = await one('select id, email, full_name, is_active from users where email = $1', [em]);
      if (u && u.is_active) {
        const token = await createPasswordReset(u.id, 60);
        // Không await gửi mail — phản hồi ngay, mailer tự log nếu thất bại.
        sendPasswordReset({ to: u.email, fullName: u.full_name, token });
      }

      // LUÔN 204 — không lộ email nào tồn tại trong hệ thống.
      return reply.code(204).send();
    }
  );

  /* -------------------------- Đặt lại mật khẩu --------------------------- */
  app.post('/api/auth/reset-password', async (req, reply) => {
    const body = req.body || {};
    const token = str(body.token, 'token', { required: true, max: 200 });
    const nextPw = str(body.new_password, 'Mật khẩu mới', { required: true, max: 200, trim: false });

    // Kiểm độ mạnh TRƯỚC khi tiêu token — mật khẩu yếu không làm mất lượt dùng link.
    const weak = checkPasswordStrength(nextPw);
    if (weak) throw badRequest(weak);

    const userId = await consumePasswordReset(token); // sai/hết hạn → 401 từ lib/auth.js
    const u = await one('select id, email, full_name, role, is_active from users where id = $1', [userId]);
    if (!u || !u.is_active) {
      throw unauthorized('Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.');
    }

    const hash = await hashPassword(nextPw);
    await query('update users set password_hash = $1, must_change_password = false where id = $2', [
      hash,
      userId,
    ]);
    await revokeAllUserTokens(userId);

    req.user = u; // route công khai — gán để nhật ký ghi đúng người thao tác
    audit(req, {
      action: 'update',
      entity: 'users',
      entityId: userId,
      summary: 'Đặt lại mật khẩu qua email.',
    });

    return reply.code(204).send();
  });
}
