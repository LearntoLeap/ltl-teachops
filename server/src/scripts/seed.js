/**
 * seed.js — Tạo tài khoản Admin đầu tiên từ biến môi trường.
 *
 * An toàn khi chạy lại nhiều lần: nếu đã có bất kỳ Admin nào thì bỏ qua hoàn toàn,
 * KHÔNG ghi đè mật khẩu của Admin đang dùng.
 */
import env from '../env.js';
import { one, query, waitForDb, closeDb } from '../db.js';
import { hashPassword } from '../lib/auth.js';

export async function seedAdmin() {
  const { email, password, name } = env.seedAdmin;

  const existing = await one("select id, email from users where role = 'admin' limit 1");
  if (existing) {
    console.log(`[seed] Đã có Admin (${existing.email}) — bỏ qua.`);
    return existing;
  }

  if (!email || !password) {
    console.warn(
      '[seed] Chưa có Admin nào và cũng chưa đặt SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.\n' +
      '       Hệ thống sẽ không đăng nhập được. Hãy điền hai biến này trong .env rồi khởi động lại.'
    );
    return null;
  }

  if (password.length < 8) {
    console.error('[seed] SEED_ADMIN_PASSWORD phải có ít nhất 8 ký tự.');
    return null;
  }

  const hash = await hashPassword(password);
  const admin = await one(
    `insert into users (email, password_hash, full_name, role, must_change_password)
     values ($1, $2, $3, 'admin', true)
     on conflict (email) do update set role = 'admin', is_active = true
     returning id, email, full_name`,
    [email.toLowerCase(), hash, name || 'Quản trị hệ thống']
  );

  console.log(
    `[seed] Đã tạo tài khoản Admin: ${admin.email}\n` +
    '       Hệ thống sẽ yêu cầu đổi mật khẩu ngay ở lần đăng nhập đầu tiên.'
  );
  return admin;
}

// Cho phép chạy độc lập:  node src/scripts/seed.js
const isDirect = process.argv[1] && process.argv[1].endsWith('seed.js');
if (isDirect) {
  waitForDb()
    .then(seedAdmin)
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[seed] Lỗi:', e.message); process.exit(1); });
}
