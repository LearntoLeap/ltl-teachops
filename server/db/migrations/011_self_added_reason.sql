-- 011 — Tự thêm TIẾT DẠY bị thiếu: bắt buộc nêu lý do.
--
-- Giáo viên/trợ giảng được tự thêm tiết bị thiếu để kịp điểm danh, nhưng Phòng
-- chuyên môn và Quản trị viên phải nhìn ra ngay: ai thêm, thêm lúc nào, và
-- VÌ SAO. Không có lý do thì không phân biệt được "lịch bị sót" với "khai thêm".

alter table schedules
  add column if not exists self_added_reason text,
  add column if not exists self_added_at     timestamptz;

comment on column schedules.self_added_reason is
  'Lý do giáo viên tự thêm tiết bị thiếu — bắt buộc khi self_added = true.';
comment on column schedules.self_added_at is 'Thời điểm tự thêm (giờ máy chủ).';

update schedules set self_added_at = created_at where self_added and self_added_at is null;

-- Tiết tự thêm: hiện cả ở lịch dạy lẫn điểm danh, kèm người thêm và lý do.
drop view if exists v_class_sessions;
create view v_class_sessions as
select
  s.id                as schedule_id,
  s.school_id,
  sc.name             as school_name,
  s.class_id,
  c.name              as class_name,
  s.session_date,
  s.period,
  s.start_time,
  s.end_time,
  s.subject,
  s.status,
  (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session as work_session,
  s.self_added,
  s.self_added_reason,
  s.self_added_at,
  cb.full_name        as added_by_name,
  u.id                as user_id,
  u.full_name,
  u.role              as user_role,
  a.role              as session_role,
  att.id              as attendance_id,
  att.checked_in_at   as class_check_in_at,
  att.roster_size,
  att.present_count,
  att.marked_by,
  mb.full_name        as marked_by_name,
  (att.id is not null) as attendance_done,
  t.id                as timesheet_id,
  t.check_in_at       as shift_check_in_at,
  t.check_out_at      as shift_check_out_at,
  coalesce(t.label, 'absent')::attend_label as shift_label
from schedules s
join schools sc on sc.id = s.school_id
join classes c  on c.id  = s.class_id
left join users cb on cb.id = s.created_by
cross join lateral (
  values (s.teacher_id, 'teacher'::class_role), (s.assistant_id, 'assistant'::class_role)
) as a (user_id, role)
join users u on u.id = a.user_id
left join attendance att on att.schedule_id = s.id
left join users mb on mb.id = att.marked_by
left join timesheets t
       on t.user_id = a.user_id
      and t.school_id = s.school_id
      and t.work_date = s.session_date
      and t.work_session = (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session
where s.status <> 'cancelled';

-- Buổi chưa điểm danh: mang theo tiết và dấu vết tự thêm để màn điểm danh hiện
-- đủ thông tin (thêm vào CUỐI danh sách cột để "create or replace view" nhận).
create or replace view v_attendance_pending as
select s.id as schedule_id, s.school_id, s.class_id, s.session_date, s.start_time,
       s.teacher_id, s.assistant_id,
       s.period, s.teacher_manual_name, s.assistant_manual_name,
       s.self_added, s.self_added_reason, s.created_by
from schedules s
left join attendance a on a.schedule_id = s.id
where a.id is null
  and s.status = 'scheduled'
  and s.session_date <= current_date;
