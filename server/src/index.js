/**
 * index.js — Điểm khởi động API.
 * Thứ tự: chờ DB → chuẩn bị thư mục tệp → seed Admin đầu tiên → mở cổng → bật job nền.
 */
import env from './env.js';
import { waitForDb, closeDb } from './db.js';
import { initStorage } from './lib/storage.js';
import { verifyMailer } from './lib/mailer.js';
import { verifyDrive } from './lib/drive.js';
import { buildApp } from './app.js';
import { seedAdmin } from './scripts/seed.js';
import { startJobs, stopJobs } from './jobs.js';

async function main() {
  console.log(`[boot] LtL TeachOps API — môi trường ${env.nodeEnv}`);

  await waitForDb();
  console.log('[boot] Kết nối cơ sở dữ liệu thành công.');

  await initStorage();
  await seedAdmin();
  await verifyMailer();
  await verifyDrive();

  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  console.log(`[boot] API đang lắng nghe tại cổng ${env.port}`);

  startJobs(app.log);

  // Tắt êm: ngừng nhận request mới, đóng kết nối DB rồi mới thoát.
  const shutdown = async (signal) => {
    console.log(`[boot] Nhận ${signal} — đang dừng…`);
    stopJobs();
    try { await app.close(); } catch (e) { console.error('[boot] Lỗi khi đóng server:', e.message); }
    try { await closeDb(); } catch (e) { console.error('[boot] Lỗi khi đóng DB:', e.message); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => {
  console.error('[boot] Promise bị từ chối mà không bắt:', err);
});

main().catch((err) => {
  console.error('[boot] Khởi động thất bại:', err);
  process.exit(1);
});
