/**
 * drive-sync.js — Đẩy thủ công toàn bộ ảnh/video/tài liệu tồn đọng lên Google Drive,
 * rồi dọn bản gốc đủ hạn trên VPS.
 *
 * Dùng khi: vừa kết nối Drive lần đầu (cần đẩy dồn ảnh cũ), hoặc sau khi sửa lỗi
 * cấu hình muốn chạy lại ngay thay vì chờ job nền 5 phút/lượt.
 *
 * Chạy trên VPS:
 *   docker compose exec api node src/scripts/drive-sync.js
 */
import { waitForDb, closeDb } from '../db.js';
import { syncPendingFiles, offloadLocalCopies, driveEnabled, verifyDrive, driveStatus } from '../lib/drive.js';
import { getThumbPath } from '../lib/storage.js';

async function main() {
  await waitForDb();
  if (!(await driveEnabled())) {
    console.error(
      '[drive:sync] Chưa kết nối Google Drive.\n' +
      '  Admin vào app → Lưu trữ Drive → Kết nối (hoặc đặt GOOGLE_CLIENT_ID,\n' +
      '  GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN trong .env).\n' +
      '  Xem docs/HUONG_DAN_GOOGLE_DRIVE.md'
    );
    process.exit(1);
  }
  if (!(await verifyDrive())) process.exit(1);

  const before = await driveStatus();
  console.log(`[drive:sync] Còn ${before.pending} tệp chờ đẩy (đã đồng bộ ${before.synced}/${before.total}).`);

  let total = 0;
  let failed = 0;
  // Đẩy theo lô cho tới khi hết hàng đợi hoặc không tiến triển thêm.
  for (;;) {
    const r = await syncPendingFiles({ limit: 25 });
    total += r.sent;
    failed += r.failed;
    if (r.sent) console.log(`[drive:sync] … đã đẩy ${total} tệp`);
    if (!r.sent) break;
  }

  const o = await offloadLocalCopies({ limit: 10_000, ensureThumb: (f) => getThumbPath(f, 480) });
  if (o.freed) console.log(`[drive:sync] Giải phóng ${o.freed} tệp (${Math.round(o.bytes / 1048576)} MB) trên VPS.`);

  const after = await driveStatus();
  console.log(
    `\n[drive:sync] Xong: đẩy ${total} tệp${failed ? `, lỗi ${failed}` : ''}.\n` +
    `             Tổng đã đồng bộ ${after.synced}/${after.total}` +
    `${after.failed ? ` · ${after.failed} tệp lỗi quá 5 lần` : ''}.`
  );
  if (after.last_error) {
    console.log(`             Lỗi gần nhất (${after.last_error_file}): ${after.last_error}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error('[drive:sync] Lỗi:', e.message);
  process.exit(1);
});
