/**
 * notify.js — Thông báo trong ứng dụng + phát realtime qua SSE.
 *
 * Luồng: route gọi notify(...) ⇒ ghi bảng notifications ⇒ đẩy ngay tới các
 * kết nối SSE đang mở của người nhận. Người dùng offline vẫn thấy khi mở lại app.
 */
import { rows, query } from '../db.js';

/** userId -> Set<reply> các kết nối SSE đang mở (một người có thể mở nhiều thiết bị). */
const streams = new Map();

export function addStream(userId, reply) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(reply);
}

export function removeStream(userId, reply) {
  const set = streams.get(userId);
  if (!set) return;
  set.delete(reply);
  if (!set.size) streams.delete(userId);
}

export function connectionCount() {
  let n = 0;
  for (const s of streams.values()) n += s.size;
  return n;
}

function push(userId, payload) {
  const set = streams.get(userId);
  if (!set || !set.size) return;
  const frame = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const reply of set) {
    try {
      reply.raw.write(frame);
    } catch {
      set.delete(reply);
    }
  }
}

/**
 * Tạo thông báo cho một hoặc nhiều người.
 * @param {string|string[]} userIds
 * @param {object} n  { kind, title, body?, link?, refId? }
 */
export async function notify(userIds, n) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  if (!ids.length) return [];

  const created = await rows(
    `insert into notifications (user_id, kind, title, body, link, ref_id)
     select uid, $2, $3, $4, $5, $6 from unnest($1::uuid[]) as uid
     returning *`,
    [ids, n.kind, n.title, n.body || null, n.link || null, n.refId || null]
  );

  for (const row of created) push(row.user_id, row);
  return created;
}

/** Thông báo cho toàn bộ Phòng chuyên môn phụ trách một trường (kèm mọi Admin). */
export async function notifySchoolManagers(schoolId, n) {
  const r = await rows(
    `select u.id from users u
      where u.is_active
        and ( u.role = 'admin'
              or (u.role = 'manager'
                  and exists (select 1 from user_schools us
                               where us.user_id = u.id and us.school_id = $1)) )`,
    [schoolId]
  );
  return notify(r.map((x) => x.id), n);
}

/** Thông báo cho mọi Giáo viên/Trợ giảng — dùng khi có học liệu chuẩn mới. */
export async function notifyFieldStaff(n, { level = null } = {}) {
  // level dùng để thu hẹp theo cấp học: chỉ báo cho người đang dạy lớp thuộc cấp đó.
  const r = level
    ? await rows(
        `select distinct u.id from users u
           join class_assignments ca on ca.user_id = u.id
           join classes c on c.id = ca.class_id
          where u.is_active and u.role in ('teacher','assistant') and c.level = $1`,
        [level]
      )
    : await rows(
        `select id from users where is_active and role in ('teacher','assistant')`
      );
  return notify(r.map((x) => x.id), n);
}

export async function markRead(userId, notificationId) {
  await query(
    'update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null',
    [notificationId, userId]
  );
}

export async function markAllRead(userId) {
  await query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
}

/** Dọn thông báo cũ hơn 90 ngày — gọi từ job nền hằng ngày. */
export async function purgeOld(days = 90) {
  const r = await query(
    `delete from notifications where created_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return r.rowCount;
}
