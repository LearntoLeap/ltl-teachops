/**
 * settings.js — Cấu hình hệ thống lưu trong bảng app_settings (Admin chỉnh trong app).
 * Bộ nhớ đệm trong tiến trình sống 30 giây (đủ nhẹ cho job nền, không lệch lâu với CSDL);
 * ghi qua patchSetting() làm mới ngay.
 */
import { one, query } from '../db.js';

const TTL_MS = 30_000;
const cache = new Map();   // key → { value, at }

export async function getSetting(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const r = await one('select value from app_settings where key = $1', [key]);
  const value = r?.value ?? null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Gộp `patch` vào giá trị hiện có (khoá có giá trị null sẽ bị xoá). */
export async function patchSetting(key, patch, userId = null) {
  cache.delete(key);
  const cur = (await getSetting(key)) || {};
  const next = { ...cur, ...patch };
  for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k];
  await query(
    `insert into app_settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(next), userId]
  );
  cache.set(key, { value: next, at: Date.now() });
  return next;
}
