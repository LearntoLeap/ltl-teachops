/**
 * auth.js — Băm mật khẩu, phát/kiểm JWT, quản lý refresh token, middleware xác thực.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../env.js';
import { one, query } from '../db.js';
import { unauthorized, mustChangePassword } from './errors.js';
import { permissionsFor } from './rbac.js';

const BCRYPT_ROUNDS = 12;

/* --------------------------------- Mật khẩu -------------------------------- */
export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Mật khẩu tạm dễ đọc, dễ đọc qua điện thoại: LtL-7K3M-92 */
export function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I, O, 0, 1 gây nhầm
  const pick = (n) => Array.from({ length: n }, () =>
    alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  return `LtL-${pick(4)}-${crypto.randomInt(10, 100)}`;
}

/** Yêu cầu tối thiểu cho mật khẩu người dùng tự đặt. */
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    return 'Mật khẩu phải có ít nhất 8 ký tự.';
  }
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Mật khẩu phải gồm cả chữ và số.';
  }
  if (/^\s|\s$/.test(pw)) {
    return 'Mật khẩu không được bắt đầu hoặc kết thúc bằng dấu cách.';
  }
  return null;
}

/* ---------------------------------- Token ---------------------------------- */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, mcp: user.must_change_password === true },
    env.jwtSecret,
    { expiresIn: env.accessTokenTtl, issuer: 'teachops' }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret, { issuer: 'teachops' });
  } catch {
    return null;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Tạo refresh token mới, lưu bản băm vào DB. Trả chuỗi thô cho client. */
export async function issueRefreshToken(userId, { userAgent, ip } = {}) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000);
  await query(
    `insert into refresh_tokens (user_id, token_hash, user_agent, ip, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [userId, sha256(raw), (userAgent || '').slice(0, 300), ip || null, expiresAt]
  );
  return raw;
}

/** Đổi refresh token lấy user. Xoay vòng: token cũ bị thu hồi ngay. */
export async function rotateRefreshToken(raw, meta = {}) {
  const hash = sha256(raw || '');
  const row = await one(
    `select rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.*
       from refresh_tokens rt join users u on u.id = rt.user_id
      where rt.token_hash = $1`,
    [hash]
  );
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
    throw unauthorized('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }
  if (!row.is_active) {
    throw unauthorized('Tài khoản đã bị khoá.');
  }
  await query('update refresh_tokens set revoked_at = now() where id = $1', [row.id]);
  const next = await issueRefreshToken(row.user_id, meta);
  return { user: row, refreshToken: next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await query('update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [sha256(raw)]);
}

export async function revokeAllUserTokens(userId) {
  await query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
}

/* ----------------------------- Đặt lại mật khẩu ---------------------------- */
export async function createPasswordReset(userId, ttlMinutes = 60) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await query(
    `insert into password_resets (user_id, token_hash, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, sha256(raw), String(ttlMinutes)]
  );
  return raw;
}

export async function consumePasswordReset(raw) {
  const row = await one(
    `select id, user_id from password_resets
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [sha256(raw || '')]
  );
  if (!row) throw unauthorized('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
  await query('update password_resets set used_at = now() where id = $1', [row.id]);
  return row.user_id;
}

/* --------------------------------- Middleware ------------------------------ */

/** Lấy token từ header Authorization, hoặc query ?token= (dành riêng cho SSE). */
function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
}

/**
 * preHandler toàn cục: nạp req.user.
 * - Route công khai (đánh dấu trong PUBLIC_PATHS ở app.js) được bỏ qua.
 * - must_change_password = true ⇒ chặn mọi route trừ đổi mật khẩu / đăng xuất / me.
 */
export async function authenticate(req) {
  const token = extractToken(req);
  if (!token) throw unauthorized();

  const payload = verifyAccessToken(token);
  if (!payload) throw unauthorized('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');

  const user = await one(
    'select id, email, full_name, phone, role, is_active, must_change_password, avatar_file_id from users where id = $1',
    [payload.sub]
  );
  if (!user || !user.is_active) throw unauthorized('Tài khoản không còn hiệu lực.');

  user.permissions = permissionsFor(user.role);
  req.user = user;
}

const PASSWORD_GATE_ALLOW = new Set([
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/health',
]);

export async function passwordGate(req) {
  if (!req.user?.must_change_password) return;
  const path = (req.routeOptions?.url || req.url || '').split('?')[0];
  if (PASSWORD_GATE_ALLOW.has(path)) return;
  throw mustChangePassword();
}

/** Cập nhật dấu thời gian đăng nhập (không chặn luồng nếu lỗi). */
export function touchLastLogin(userId) {
  query('update users set last_login_at = now() where id = $1', [userId])
    .catch((e) => console.error('[auth] Không cập nhật được last_login_at:', e.message));
}
