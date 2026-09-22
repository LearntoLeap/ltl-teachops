-- 013 — Thiết bị THEO LOẠI khi chấm công vào / ra.
--
-- Trước đây chấm công chỉ lưu MỘT con số tổng (check_in_device_count) — không
-- biết đếm được bao nhiêu robot, bao nhiêu laptop, tablet. Nay lưu chi tiết
-- từng loại, đầu buổi và cuối buổi, để đối chiếu được thiếu hụt:
--   [{ name, qty, unit, catalog_id?, expected? }]
-- check_in_device_count vẫn giữ = tổng số, cho báo cáo và client cũ.

alter table timesheets
  add column if not exists check_in_devices  jsonb,
  add column if not exists check_out_devices jsonb,
  -- Cuối buổi đếm được ÍT hơn đầu buổi ở ít nhất một loại.
  add column if not exists device_shortage   boolean not null default false;

comment on column timesheets.check_in_devices  is 'Thiết bị đầu buổi theo loại: [{name, qty, unit, catalog_id, expected}].';
comment on column timesheets.check_out_devices is 'Thiết bị cuối buổi theo loại: [{name, qty, unit, catalog_id}].';
comment on column timesheets.device_shortage   is 'true = cuối buổi thiếu so với đầu buổi ở ít nhất một loại.';

-- View chấm công theo buổi: mang theo chi tiết thiết bị (thêm vào cuối).
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
      and s.status <> 'cancelled'
      and (s.teacher_id = t.user_id or s.assistant_id = t.user_id)
      and (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session = t.work_session
  )::int as planned_periods,
  t.check_in_devices,
  t.check_out_devices,
  t.device_shortage
from timesheets t
join users u   on u.id  = t.user_id
join schools sc on sc.id = t.school_id;
