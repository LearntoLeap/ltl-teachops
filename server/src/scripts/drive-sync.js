/**
 * drive-sync.js — Đẩy thủ công toàn bộ ảnh/tài liệu tồn đọng lên Google Drive.
 *
 * Dùng khi: vừa bật Drive lần đầu (cần đẩy dồn ảnh cũ), hoặc sau khi sửa lỗi
 * cấu hình muốn chạy lại ngay thay vì chờ job nền 5 phút/lượt.
 *
 * Chạy trên VPS:
 *   docker compose exec api node src/scripts/drive-sync.js
 */
import { waitForDb, closeDb, one } from '../db.js';
import { syncPendingFiles, driveEnabled, verifyDrive, driveStatus } from '../lib/drive.js';

async function main() {
  if (!driveEnabled()) {
    console.error(
      '[drive:sync] Chưa cấu hình Google Drive.\n' +
      '  Cần đủ 4 biến trong .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,\n' +
      '  GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID.\n' +
      '  Xem docs/HUONG_DAN_GOOGLE_DRIVE.md'
    );
    process.exit(1);
  }

  await waitForDb();
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
    if (!r.sent) break;             // hết tệp gửi được (hoặc toàn lỗi) ⇒ dừng
  }

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
  void one;
}

main().catch((e) => {
  console.error('[drive:sync] Lỗi:', e.message);
  process.exit(1);
});
