/**
 * search.js — Tìm kiếm nhanh toàn cục (ô tìm kiếm trên thanh đầu trang).
 *
 * GET /api/search?q=  → kết quả gộp theo nhóm, MỖI NHÓM TỐI ĐA 5 dòng,
 * đã lọc theo phạm vi vai trò như mọi màn hình khác:
 *   - schools/classes: theo visibleSchoolIds
 *   - users: chỉ admin/manager
 *   - materials: khu "Giáo viên" chỉ thấy bài của mình hoặc đã duyệt
 *   - solutions: mọi người
 *   - schedules: buổi sắp tới trong phạm vi (7 ngày)
 */
import { rows } from '../db.js';
import { can } from '../lib/rbac.js';
import { visibleSchoolIds } from '../lib/scope.js';
import { str } from '../lib/validate.js';

const LIMIT = 5;

export default async function routes(app) {
  app.get('/api/search', async (req) => {
    const q = str(req.query.q, 'q', { max: 100 });
    if (!q || q.length < 2) {
      return { q: q || '', schools: [], classes: [], users: [], materials: [], solutions: [], schedules: [] };
    }
    const like = `%${q}%`;
    const me = req.user;
    const ids = await visibleSchoolIds(me);          // null = admin (tất cả)
    const schoolCond = ids === null ? 'true' : 's.id = any($2)';
    const schoolParam = ids === null ? [] : [ids];

    const [schools, classes, users, materials, solutions, schedules] = await Promise.all([
      // Trường
      rows(
        `select s.id, s.name, s.code, s.province from schools s
          where s.is_active and (s.name ilike $1 or s.code ilike $1) and ${schoolCond}
          order by s.name limit ${LIMIT}`,
        [like, ...schoolParam]
      ),
      // Lớp
      rows(
        `select c.id, c.name, c.grade, s.name as school_name, s.id as school_id
           from classes c join schools s on s.id = c.school_id
          where c.is_active and c.name ilike $1 and ${schoolCond}
          order by s.name, c.name limit ${LIMIT}`,
        [like, ...schoolParam]
      ),
      // Người dùng — chỉ admin/manager
      can(me, 'users.view')
        ? rows(
            `select id, full_name, email, role from users
              where is_active and (full_name ilike $1 or email ilike $1)
              order by full_name limit ${LIMIT}`,
            [like]
          )
        : Promise.resolve([]),
      // Học liệu (kèm tên bài / chương trình)
      rows(
        `select m.id, m.title, m.area, m.level, m.grade, m.lesson_no, m.lesson_title,
                m.curriculum, t.name as type_name, t.icon as type_icon
           from materials m
           left join material_types t on t.id = m.type_id
          where not m.is_archived
            and (m.title ilike $1 or m.lesson_title ilike $1 or m.curriculum ilike $1 or m.subject ilike $1)
            and (m.area = 'official'
                 or m.owner_id = $2
                 or $3
                 or m.approval_status = 'approved')
          order by m.created_at desc limit ${LIMIT}`,
        [like, me.id, can(me, 'material.approve')]
      ),
      // Giải pháp
      rows(
        `select id, name, grp, level from solutions
          where is_active and name ilike $1 order by sort_order limit ${LIMIT}`,
        [like]
      ),
      // Buổi dạy 7 ngày tới trong phạm vi (khớp tên lớp/trường/giáo viên)
      (() => {
        const params = [like];
        let scopeCond = 'true';
        if (ids !== null && me.role === 'manager') {
          params.push(ids);
          scopeCond = `s.id = any($${params.length})`;
        } else if (ids !== null) {
          params.push(me.id);
          scopeCond = `(sch.teacher_id = $${params.length} or sch.assistant_id = $${params.length})`;
        }
        return rows(
          `select sch.id, sch.session_date, sch.start_time, sch.end_time,
                  c.name as class_name, s.name as school_name, u.full_name as teacher_name
             from schedules sch
             join schools s on s.id = sch.school_id
             join classes c on c.id = sch.class_id
             left join users u on u.id = sch.teacher_id
            where sch.status = 'scheduled'
              and sch.session_date between current_date and current_date + 7
              and (c.name ilike $1 or s.name ilike $1 or u.full_name ilike $1)
              and ${scopeCond}
            order by sch.session_date, sch.start_time limit ${LIMIT}`,
          params
        );
      })(),
    ]);

    return { q, schools, classes, users, materials, solutions, schedules };
  });
}
