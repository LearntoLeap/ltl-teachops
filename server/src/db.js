/**
 * db.js — Kết nối PostgreSQL dùng chung.
 *
 * Quy ước cho mọi route:
 *   - Luôn dùng tham số $1, $2… — TUYỆT ĐỐI không nối chuỗi SQL từ dữ liệu người dùng.
 *   - Cần nhiều lệnh ghi liên quan nhau ⇒ bọc trong tx() để rollback trọn gói.
 */
import pg from 'pg';
import env from './env.js';

// Postgres trả DATE dưới dạng chuỗi 'YYYY-MM-DD' thay vì Date của JS
// (tránh lệch múi giờ khi serialize sang JSON).
pg.types.setTypeParser(1082, (v) => v);
// BIGINT → Number (an toàn vì không bảng nào vượt 2^53 bản ghi).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'teachops-api',
});

pool.on('error', (err) => {
  console.error('[db] Lỗi kết nối nhàn rỗi:', err.message);
});

/** Truy vấn đơn. Trả về pg.Result. */
export function query(text, params) {
  return pool.query(text, params);
}

/** Trả về mảng bản ghi. */
export async function rows(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Trả về bản ghi đầu tiên hoặc null. */
export async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

/** Trả về giá trị cột đầu của bản ghi đầu (dùng cho count/exists). */
export async function scalar(text, params) {
  const r = await pool.query(text, params);
  if (!r.rows.length) return null;
  return Object.values(r.rows[0])[0];
}

/**
 * Giao dịch. Callback nhận client; throw bất kỳ ⇒ ROLLBACK.
 *   await tx(async (c) => { await c.query(...); await c.query(...); });
 */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* bỏ qua */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Chờ DB sẵn sàng lúc khởi động (container db có thể lên chậm hơn api). */
export async function waitForDb(retries = 30, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('select 1');
      return true;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`[db] Chưa sẵn sàng (lần ${i}/${retries}) — thử lại sau ${delayMs / 1000}s…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

export async function closeDb() {
  await pool.end();
}

export default { pool, query, rows, one, scalar, tx, waitForDb, closeDb };
