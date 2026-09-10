/**
 * audit.js — Nhật ký thao tác.
 *
 * Bắt buộc ghi cho MỌI thay đổi chạm tới dữ liệu chấm công / lương / tài khoản:
 * tạo–sửa–xoá người dùng, sửa tay chấm công, duyệt/từ chối, đổi lịch, đổi cấu hình trường.
 * Ghi lỗi không được làm hỏng nghiệp vụ ⇒ luôn nuốt lỗi và chỉ log ra console.
 */
import { query } from '../db.js';

/**
 * @param {object} req      Request Fastify (để lấy user, IP, user-agent)
 * @param {object} entry
 * @param {string} entry.action   create | update | delete | approve | reject | login | export…
 * @param {string} entry.entity   tên bảng, ví dụ 'timesheets'
 * @param {string} [entry.entityId]
 * @param {string} [entry.summary] Mô tả tiếng Việt, hiển thị trên màn hình Nhật ký
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 */
export function audit(req, entry) {
  const user = req?.user || null;
  const ip = req?.headers?.['x-real-ip'] || req?.ip || null;

  query(
    `insert into audit_log
       (actor_id, actor_email, action, entity, entity_id, summary, before_data, after_data, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      user?.id || null,
      user?.email || null,
      entry.action,
      entry.entity,
      entry.entityId ? String(entry.entityId) : null,
      entry.summary || null,
      entry.before ? JSON.stringify(scrub(entry.before)) : null,
      entry.after ? JSON.stringify(scrub(entry.after)) : null,
      ip,
      (req?.headers?.['user-agent'] || '').slice(0, 300) || null,
    ]
  ).catch((e) => console.error('[audit] Không ghi được nhật ký:', e.message));
}

/** Loại bỏ trường nhạy cảm khỏi bản ghi nhật ký. */
const SENSITIVE = new Set(['password', 'password_hash', 'token', 'token_hash', 'new_password', 'current_password']);
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.has(k)) out[k] = '***';
    else if (v && typeof v === 'object') out[k] = scrub(v);
    else out[k] = v;
  }
  return out;
}
