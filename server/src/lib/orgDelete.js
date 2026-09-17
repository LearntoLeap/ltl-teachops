/**
 * orgDelete.js — Xoá hẳn trường / lớp: đếm trước xem mất những gì.
 *
 * Mọi bảng nghiệp vụ đều trỏ về schools/classes bằng khoá ngoại `on delete cascade`,
 * nên `delete from schools` sẽ kéo theo cả lịch dạy, chấm công, điểm danh… Vì vậy:
 *
 *   blockers — dữ liệu VẬN HÀNH đã phát sinh. Còn một mục ⇒ CHẶN xoá hẳn,
 *              chỉ cho "Ngừng sử dụng" (is_active = false) để giữ lịch sử.
 *   cleanup  — cấu hình đi kèm, xoá cùng là đúng ý người dùng (lớp rỗng, phòng
 *              STEM, danh mục thiết bị, phân công…). Chỉ để báo trước cho rõ.
 *
 * Nhờ đó nút "Xoá hẳn" chỉ dùng được cho bản ghi NHẬP SAI — thứ chưa ai dùng tới.
 */
import { scalar } from '../db.js';

/** Đếm một bảng theo cột khoá; trả { label, count } khi > 0, không thì null. */
async function count(label, sql, params) {
  const n = Number(await scalar(sql, params)) || 0;
  return n > 0 ? { label, count: n } : null;
}

const compact = (list) => list.filter(Boolean);

/** Gộp thành câu tiếng Việt: "3 buổi dạy, 2 lượt kiểm tra thiết bị". */
export function listOf(items) {
  return items.map((i) => `${i.count} ${i.label}`).join(', ');
}

/** Trường: xoá hẳn được không, và kéo theo những gì. */
export async function schoolDeleteImpact(schoolId) {
  const p = [schoolId];
  const blockers = compact(await Promise.all([
    count('buổi dạy đã xếp', 'select count(*) from schedules where school_id = $1', p),
    count('lượt kiểm tra thiết bị', 'select count(*) from device_checks where school_id = $1', p),
    count('báo hỏng thiết bị', 'select count(*) from device_issues where school_id = $1', p),
  ]));
  const cleanup = compact(await Promise.all([
    count('lớp học', 'select count(*) from classes where school_id = $1', p),
    count('phòng STEM', 'select count(*) from stem_rooms where school_id = $1', p),
    count('thiết bị trong danh mục', 'select count(*) from device_catalog where school_id = $1', p),
    count('lượt phân công quản lý', 'select count(*) from user_schools where school_id = $1', p),
    count('phân công giáo viên/trợ giảng',
      'select count(*) from class_assignments ca join classes c on c.id = ca.class_id where c.school_id = $1', p),
  ]));
  // Học liệu và góp ý chỉ bị gỡ liên kết (on delete set null), không mất bản ghi.
  const unlinked = compact(await Promise.all([
    count('học liệu sẽ bỏ gắn trường', 'select count(*) from materials where school_id = $1', p),
    count('góp ý sẽ bỏ gắn trường', 'select count(*) from feedback where school_id = $1', p),
  ]));
  return { can_hard_delete: blockers.length === 0, blockers, cleanup, unlinked };
}

/** Lớp: xoá hẳn được không, và kéo theo những gì. */
export async function classDeleteImpact(classId) {
  const p = [classId];
  const blockers = compact(await Promise.all([
    count('buổi dạy đã xếp', 'select count(*) from schedules where class_id = $1', p),
  ]));
  const cleanup = compact(await Promise.all([
    count('phân công giáo viên/trợ giảng', 'select count(*) from class_assignments where class_id = $1', p),
  ]));
  const unlinked = compact(await Promise.all([
    count('học liệu sẽ bỏ gắn lớp', 'select count(*) from materials where class_id = $1', p),
    count('góp ý sẽ bỏ gắn lớp', 'select count(*) from feedback where class_id = $1', p),
  ]));
  return { can_hard_delete: blockers.length === 0, blockers, cleanup, unlinked };
}
