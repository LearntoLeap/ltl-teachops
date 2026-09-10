/**
 * scope.js — Lọc dữ liệu theo phạm vi vai trò (row-level scoping).
 *
 * NGUYÊN TẮC BẤT DI BẤT DỊCH:
 *   1. Không tin school_id/class_id client gửi lên — luôn đọc từ DB rồi đối chiếu.
 *   2. Bản ghi ngoài phạm vi ⇒ trả 404 (notFound), không phải 403 — tránh lộ sự tồn tại.
 *   3. Mọi endpoint danh sách PHẢI gọi một trong các hàm dưới đây.
 *
 * Quy ước: các hàm *Filter trả về { sql, params } để nối vào mệnh đề WHERE,
 * với `next` là số thứ tự tham số kế tiếp ($1, $2…) mà truy vấn đang dùng.
 */
import { one, rows } from '../db.js';
import { notFound } from './errors.js';

/** Danh sách school_id mà người dùng được phép nhìn thấy. Trả null nghĩa là "tất cả". */
export async function visibleSchoolIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;                 // null = không giới hạn

  if (user.role === 'manager') {
    const r = await rows('select school_id from user_schools where user_id = $1', [user.id]);
    return r.map((x) => x.school_id);
  }

  // teacher / assistant: trường nào có lớp mình phụ trách hoặc buổi mình được phân công
  const r = await rows(
    `select distinct sid from (
       select c.school_id as sid
         from class_assignments ca join classes c on c.id = ca.class_id
        where ca.user_id = $1
       union
       select s.school_id from schedules s
        where s.teacher_id = $1 or s.assistant_id = $1
     ) t`,
    [user.id]
  );
  return r.map((x) => x.sid);
}

/**
 * Mệnh đề lọc theo trường.
 * @param {object} user
 * @param {string} col  Tên cột school_id đầy đủ, ví dụ 's.school_id'
 * @param {number} next Số thứ tự tham số kế tiếp
 */
export async function schoolFilter(user, col, next) {
  const ids = await visibleSchoolIds(user);
  if (ids === null) return { sql: 'true', params: [], next };
  if (!ids.length) return { sql: 'false', params: [], next };   // không có trường nào ⇒ rỗng
  return { sql: `${col} = any($${next})`, params: [ids], next: next + 1 };
}

/**
 * Mệnh đề lọc cho bảng schedules (bí danh mặc định 's').
 * teacher/assistant chỉ thấy buổi mình được phân công.
 */
export async function scheduleFilter(user, alias = 's', next = 1) {
  if (user.role === 'admin') return { sql: 'true', params: [], next };

  if (user.role === 'manager') {
    return schoolFilter(user, `${alias}.school_id`, next);
  }

  return {
    sql: `(${alias}.teacher_id = $${next} or ${alias}.assistant_id = $${next})`,
    params: [user.id],
    next: next + 1,
  };
}

/** Kết hợp nhiều mệnh đề lọc thành một chuỗi WHERE và mảng tham số nối tiếp nhau. */
export function combine(base, ...filters) {
  const parts = [base].filter(Boolean);
  const params = [];
  for (const f of filters) {
    if (!f) continue;
    parts.push(f.sql);
    params.push(...f.params);
  }
  return { where: parts.length ? parts.join(' and ') : 'true', params };
}

/* ---------------------------------------------------------------------------
 * Kiểm tra quyền trên MỘT bản ghi cụ thể. Ném notFound() nếu ngoài phạm vi.
 * ------------------------------------------------------------------------- */

/** Trường. */
export async function assertSchoolAccess(user, schoolId) {
  const s = await one('select * from schools where id = $1', [schoolId]);
  if (!s) throw notFound('Không tìm thấy trường.');
  if (user.role === 'admin') return s;
  const ids = await visibleSchoolIds(user);
  if (ids === null || ids.includes(schoolId)) return s;
  throw notFound('Không tìm thấy trường.');
}

/** Lớp — trả về lớp kèm school_id. */
export async function assertClassAccess(user, classId) {
  const c = await one('select * from classes where id = $1', [classId]);
  if (!c) throw notFound('Không tìm thấy lớp.');
  if (user.role === 'admin') return c;

  if (user.role === 'manager') {
    const ids = await visibleSchoolIds(user);
    if (ids.includes(c.school_id)) return c;
    throw notFound('Không tìm thấy lớp.');
  }

  // teacher/assistant: được phân công lớp này, hoặc có buổi dạy ở lớp này
  const ok = await one(
    `select 1 from class_assignments where class_id = $1 and user_id = $2
     union all
     select 1 from schedules where class_id = $1 and (teacher_id = $2 or assistant_id = $2)
     limit 1`,
    [classId, user.id]
  );
  if (ok) return c;
  throw notFound('Không tìm thấy lớp.');
}

/**
 * Buổi dạy — trả về bản ghi schedule đầy đủ (đã kèm tên trường/lớp).
 * Đây là hàm được dùng nhiều nhất: chấm công và điểm danh đều bắt đầu từ đây.
 */
export async function assertScheduleAccess(user, scheduleId) {
  const s = await one(
    `select sch.*, sc.name as school_name, sc.lat as school_lat, sc.lng as school_lng,
            sc.gps_radius_m, sc.grace_minutes,
            c.name as class_name, c.roster_size, c.level,
            t.full_name as teacher_name, a.full_name as assistant_name,
            r.name as room_name
       from schedules sch
       join schools sc on sc.id = sch.school_id
       join classes c  on c.id  = sch.class_id
       left join users t on t.id = sch.teacher_id
       left join users a on a.id = sch.assistant_id
       left join stem_rooms r on r.id = sch.room_id
      where sch.id = $1`,
    [scheduleId]
  );
  if (!s) throw notFound('Không tìm thấy buổi dạy.');
  if (user.role === 'admin') return s;

  if (user.role === 'manager') {
    const ids = await visibleSchoolIds(user);
    if (ids.includes(s.school_id)) return s;
    throw notFound('Không tìm thấy buổi dạy.');
  }

  if (s.teacher_id === user.id || s.assistant_id === user.id) return s;
  throw notFound('Không tìm thấy buổi dạy.');
}

/** Phòng STEM. */
export async function assertRoomAccess(user, roomId) {
  const r = await one(
    `select r.*, s.name as school_name from stem_rooms r
      join schools s on s.id = r.school_id where r.id = $1`,
    [roomId]
  );
  if (!r) throw notFound('Không tìm thấy phòng STEM.');
  if (user.role === 'admin') return r;

  const ids = await visibleSchoolIds(user);
  if (ids === null || ids.includes(r.school_id)) return r;
  throw notFound('Không tìm thấy phòng STEM.');
}

/**
 * Vai trò của người dùng trong một buổi cụ thể ('teacher' | 'assistant' | null).
 * Dùng để ghi timesheets.role — KHÔNG lấy từ client.
 */
export function roleInSchedule(user, schedule) {
  if (schedule.teacher_id === user.id) return 'teacher';
  if (schedule.assistant_id === user.id) return 'assistant';
  return null;
}
