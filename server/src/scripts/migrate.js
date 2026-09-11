/**
 * migrate.js — Áp dụng các migration MỚI cho cơ sở dữ liệu đang có dữ liệu.
 *
 * Cơ chế:
 *   - Bảng schema_migrations ghi nhận file đã chạy (file_name là khoá chính).
 *   - Quét server/db/migrations/*.sql theo thứ tự tên file; file chưa ghi nhận
 *     được chạy trọn trong một giao dịch rồi ghi nhận — lỗi giữa chừng ⇒ rollback.
 *   - RIÊNG 001_init.sql: DB dựng qua docker-entrypoint-initdb.d đã chạy sẵn file này,
 *     nên nếu bảng `users` tồn tại thì chỉ đánh dấu đã chạy, KHÔNG thực thi lại.
 *
 * Chạy độc lập:  node src/scripts/migrate.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, rows, scalar, tx, waitForDb, closeDb } from '../db.js';

// Thư mục migrations: src/scripts → ../../db/migrations = server/db/migrations
const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export async function runMigrations() {
  await query(
    `create table if not exists schema_migrations (
       file_name  text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_, 002_… — thứ tự theo tên file

  let done = new Set(
    (await rows('select file_name from schema_migrations')).map((r) => r.file_name)
  );

  /* ------------------------------------------------------------------------
   * Trường hợp CSDL dựng lần đầu qua docker-entrypoint-initdb.d:
   * Postgres đã chạy TOÀN BỘ file .sql trong thư mục migrations theo thứ tự
   * tên, nhưng bảng schema_migrations lúc đó chưa có nên không ghi nhận gì.
   * Dấu hiệu nhận biết: bảng users đã tồn tại mà sổ theo dõi hoàn toàn trống.
   * Khi đó ghi nhận HẾT các file hiện có — chạy lại sẽ lỗi "already exists".
   * ---------------------------------------------------------------------- */
  if (done.size === 0) {
    const usersTable = await scalar("select to_regclass('public.users')");
    if (usersTable) {
      for (const f of files) {
        await query(
          'insert into schema_migrations (file_name) values ($1) on conflict do nothing',
          [f]
        );
      }
      done = new Set(files);
      console.log(
        `[migrate] CSDL đã được khởi tạo sẵn qua initdb — ghi nhận ${files.length} migration ` +
        'là đã chạy, không thực thi lại.'
      );
    }
  }

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;

    const sqlText = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] Đang chạy ${file}…`);
    await tx(async (c) => {
      await c.query(sqlText);
      await c.query('insert into schema_migrations (file_name) values ($1)', [file]);
    });
    applied++;
    console.log(`[migrate] Hoàn tất ${file}.`);
  }

  if (applied === 0) {
    console.log('[migrate] Không có migration mới — cơ sở dữ liệu đã ở phiên bản mới nhất.');
  } else {
    console.log(`[migrate] Đã áp dụng ${applied} migration mới.`);
  }
  return applied;
}

// Cho phép chạy độc lập:  node src/scripts/migrate.js
const isDirect = process.argv[1] && process.argv[1].endsWith('migrate.js');
if (isDirect) {
  waitForDb()
    .then(runMigrations)
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[migrate] Lỗi:', e.message);
      process.exit(1);
    });
}
