/**
 * env.js — Đọc & kiểm tra biến môi trường một lần duy nhất lúc khởi động.
 * Thiếu biến bắt buộc ⇒ dừng ngay với thông báo rõ ràng, không để chạy nửa vời.
 */
const required = ['DATABASE_URL', 'JWT_SECRET'];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    '[env] Thiếu biến môi trường bắt buộc: ' + missing.join(', ') +
    '\n      Kiểm tra lại file .env trên VPS (tham chiếu .env.example).'
  );
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[env] JWT_SECRET quá ngắn (cần ≥ 32 ký tự). Sinh khoá mới: openssl rand -base64 48');
  process.exit(1);
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: Number(process.env.PORT || 3000),

  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),

  corsOrigins: list(process.env.CORS_ORIGINS),

  uploadDir: process.env.UPLOAD_DIR || '/data/uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
  // Video minh chứng (điểm danh, báo hỏng, góp ý, học liệu video) — ghi luồng xuống đĩa.
  maxVideoBytes: Number(process.env.MAX_VIDEO_MB || 100) * 1024 * 1024,

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || '',
    password: process.env.SEED_ADMIN_PASSWORD || '',
    name: process.env.SEED_ADMIN_NAME || 'Quản trị hệ thống',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'LtL TeachOps <no-reply@learntoleap.vn>',
  },
  get mailEnabled() { return !!this.smtp.host; },

  appPublicUrl: (process.env.APP_PUBLIC_URL || '').replace(/\/+$/, ''),
  // Địa chỉ công khai của API (dùng làm redirect URI khi kết nối Google Drive).
  // Bỏ trống ⇒ suy từ request (cần proxy chuyển đúng Host + X-Forwarded-Proto).
  apiPublicUrl: (process.env.API_PUBLIC_URL || '').replace(/\/+$/, ''),

  // Google Drive của tài khoản quản trị chính — thường kết nối ngay trong app
  // (Lưu trữ Drive → Kết nối). Các biến dưới đây chỉ là cách cấu hình dự phòng.
  drive: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '',
    syncMinutes: Number(process.env.DRIVE_SYNC_MINUTES || 5),
    // Giữ bản gốc ảnh/video trên VPS bao nhiêu ngày sau khi đã lên Drive (Admin đổi được trong app).
    keepLocalDays: Number(process.env.DRIVE_KEEP_LOCAL_DAYS || 7),
  },
};

export default env;
