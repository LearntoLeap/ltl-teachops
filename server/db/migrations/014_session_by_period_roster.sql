-- 014 — Buổi chấm công tính theo TIẾT + điểm danh không giới hạn sĩ số.
--
-- 1. Buổi của một tiết: tiết 1–5 là buổi SÁNG, tiết 6 trở đi là buổi CHIỀU.
--    Trước đây suy theo giờ bắt đầu (trước 12:00 là sáng) — lệch khi trường
--    xếp tiết 5 lúc 11:45 hay tiết 6 lúc 12:30. Tiết cũ chưa có số tiết vẫn
--    suy theo giờ như trước.
-- 2. Điểm danh: giáo viên điền CẢ số có mặt lẫn sĩ số thực tế của buổi đó
--    ("26/30"). Bỏ ràng buộc "có mặt ≤ sĩ số chuẩn + 20" và trần 200 em/lớp.

create or replace function schedule_session(p_period integer, p_start time)
returns work_session
language sql immutable as $$
  select (case
            when p_period is not null then
              case when p_period <= 5 then 'morning' else 'afternoon' end
            when p_start < '12:00' then 'morning'
            else 'afternoon'
          end)::work_session
$$;

comment on function schedule_session(integer, time) is
  'Buổi của một tiết: tiết 1–5 = sáng, 6+ = chiều; tiết không số thì theo giờ (trước 12:00 = sáng).';

/* ------------------------------ Điểm danh ------------------------------ */
alter table attendance drop constraint if exists attendance_count_chk;
alter table attendance add constraint attendance_count_chk
  check (present_count >= 0 and roster_size >= 0);

alter table classes drop constraint if exists classes_roster_chk;
alter table classes add constraint classes_roster_chk check (roster_size >= 0);

comment on column attendance.roster_size is 'Sĩ số thực tế của buổi do người điểm danh điền (bản cũ: sĩ số chuẩn của lớp).';

/* --------------------- View chấm công theo buổi --------------------- */
create or replace view v_work_shifts as
select
  t.id                as timesheet_id,
  t.user_id,
  u.full_name,
  u.role              as user_role,
  t.school_id,
  sc.name             as school_name,
  t.work_date,
  t.work_session,
  t.planned_start_time,
  t.check_in_at,
  t.check_out_at,
  t.check_in_device_count,
  t.device_ok,
  t.damage_note,
  coalesce(t.label, 'absent')::attend_label as label,
  coalesce(t.late_minutes, 0)    as late_minutes,
  coalesce(t.work_minutes, 0)    as work_minutes,
  coalesce(t.gps_flagged, false) as gps_flagged,
  t.unscheduled,
  t.approval_status,
  (select count(*) from schedules s
    where s.school_id = t.school_id
      and s.session_date = t.work_date
      and s.status not in ('cancelled', 'skipped')
      and (s.teacher_id = t.user_id or s.assistant_id = t.user_id)
      and schedule_session(s.period, s.start_time) = t.work_session
  )::int as planned_periods,
  t.check_in_devices,
  t.check_out_devices,
  t.device_shortage
from timesheets t
join users u   on u.id  = t.user_id
join schools sc on sc.id = t.school_id;

/* ------------------- View đối chiếu từng tiết ------------------- */
create or replace view v_class_sessions as
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
  s.status::text      as status,
  s.status_reason,
  sb.full_name        as status_changed_by_name,
  schedule_session(s.period, s.start_time) as work_session,
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
left join users sb on sb.id = s.status_changed_by
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
      and t.work_session = schedule_session(s.period, s.start_time);
