-- 010 — Tách bạch CHẤM CÔNG và LỊCH DẠY.
--
-- Trước đây chấm công gắn vào TỪNG TIẾT (timesheets.schedule_id), nên dạy 3 tiết
-- một buổi thì có 3 lần check-in. Không đúng thực tế: giáo viên đến trường chấm
-- công MỘT LẦN đầu buổi và MỘT LẦN cuối buổi.
--
-- Mô hình mới:
--   • Chấm công  = 1 bản ghi cho mỗi (người, ngày, buổi sáng/chiều, trường).
--                  Kèm kiểm thiết bị đầu buổi và cuối buổi. Không gắn tiết.
--   • Lịch dạy   = từng tiết; trong tiết giáo viên CHECK TẠI LỚP + ĐIỂM DANH SĨ SỐ
--                  (ghi vào bảng attendance).
--   • Lịch dạy chỉ dùng để NHẮC giờ và để tính "đến đúng giờ chưa" (so với tiết
--     đầu tiên của buổi).

create type work_session as enum ('morning', 'afternoon');

/* ---------------------------- 1. CHẤM CÔNG THEO BUỔI ---------------------- */

alter table timesheets
  add column if not exists school_id    uuid references schools (id) on delete cascade,
  add column if not exists work_date    date,
  add column if not exists work_session work_session,
  -- Chấm công không khớp tiết nào trong lịch ⇒ Phòng chuyên môn soát lại.
  add column if not exists unscheduled  boolean not null default false,
  -- Giờ dự kiến có mặt (tiết đầu của buổi) — chốt lại lúc check-in để về sau
  -- đổi lịch không làm thay đổi kết quả "đúng giờ / trễ" đã tính.
  add column if not exists planned_start_time time;

-- Suy trường/ngày/buổi từ tiết đã gắn trước đây.
update timesheets t
   set school_id    = s.school_id,
       work_date    = s.session_date,
       work_session = (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session,
       planned_start_time = coalesce(t.planned_start_time, s.start_time)
  from schedules s
 where s.id = t.schedule_id
   and t.work_date is null;

-- Gộp các bản ghi cùng một buổi (mỗi tiết một dòng trước đây) thành MỘT dòng:
-- giữ dòng check-in sớm nhất, lấy giờ ra muộn nhất và thiết bị cuối buổi của dòng đó.
with ranked as (
  select id, user_id, work_date, work_session, school_id,
         row_number() over (
           partition by user_id, work_date, work_session, school_id
           order by check_in_at nulls last, created_at
         ) as rn
    from timesheets
   where work_date is not null
),
keeper as (select * from ranked where rn = 1),
merged as (
  select k.id,
         max(t.check_out_at)                                        as check_out_at,
         max(t.work_minutes)                                        as work_minutes,
         bool_and(coalesce(t.device_ok, true))                      as device_ok,
         bool_or(t.gps_flagged)                                     as gps_flagged
    from keeper k
    join timesheets t
      on t.user_id = k.user_id and t.work_date = k.work_date
     and t.work_session = k.work_session and t.school_id is not distinct from k.school_id
   group by k.id
)
update timesheets t
   set check_out_at = coalesce(t.check_out_at, m.check_out_at),
       work_minutes = coalesce(t.work_minutes, m.work_minutes),
       device_ok    = coalesce(t.device_ok, m.device_ok),
       gps_flagged  = t.gps_flagged or m.gps_flagged
  from merged m
 where t.id = m.id;

-- Xoá các dòng thừa của cùng một buổi (khai báo lại CTE — phạm vi CTE chỉ nằm
-- trong đúng câu lệnh khai báo).
with ranked as (
  select id,
         row_number() over (
           partition by user_id, work_date, work_session, school_id
           order by check_in_at nulls last, created_at
         ) as rn
    from timesheets
   where work_date is not null
)
delete from timesheets t
 using ranked r
 where r.id = t.id and r.rn > 1;

-- Bản ghi cũ không suy được buổi (tiết đã bị xoá) thì bỏ — không có giá trị đối chiếu.
delete from timesheets where work_date is null;

alter table timesheets drop constraint if exists timesheets_schedule_id_user_id_key;
alter table timesheets alter column schedule_id drop not null;
alter table timesheets alter column role drop not null;
alter table timesheets alter column work_date set not null;
alter table timesheets alter column work_session set not null;

-- Một người, một ngày, một buổi, một trường ⇒ đúng một bản ghi chấm công.
create unique index if not exists timesheets_shift_key
  on timesheets (user_id, work_date, work_session, school_id);
create index if not exists timesheets_shift_lookup_idx
  on timesheets (school_id, work_date, work_session);

comment on column timesheets.schedule_id is
  'Tiết đầu tiên của buổi theo lịch — chỉ để tham chiếu; chấm công KHÔNG thuộc về tiết.';
comment on column timesheets.work_session is 'Buổi chấm công: morning (trước 12:00) | afternoon.';

/* -------------------- 2. CHECK TẠI LỚP TRONG TỪNG TIẾT -------------------- */

alter table attendance
  add column if not exists checked_in_at       timestamptz,
  add column if not exists check_in_lat        double precision,
  add column if not exists check_in_lng        double precision,
  add column if not exists check_in_distance_m integer,
  add column if not exists gps_flagged         boolean not null default false;

comment on column attendance.checked_in_at is
  'Giờ giáo viên check TẠI LỚP cho tiết này (khác chấm công đầu buổi).';

-- Bản ghi điểm danh cũ coi như đã check tại lớp lúc tạo.
update attendance set checked_in_at = created_at where checked_in_at is null;

/* ------------------------------- 3. CÁC VIEW ------------------------------ */

drop view if exists v_timesheet_reconcile;

-- Chấm công theo buổi — nguồn của bảng chấm công và bảng lương.
create view v_work_shifts as
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
  -- Số tiết theo lịch trong buổi đó, để đối chiếu công với lịch dạy.
  (select count(*) from schedules s
    where s.school_id = t.school_id
      and s.session_date = t.work_date
      and s.status <> 'cancelled'
      and (s.teacher_id = t.user_id or s.assistant_id = t.user_id)
      and (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session = t.work_session
  )::int as planned_periods
from timesheets t
join users u   on u.id  = t.user_id
join schools sc on sc.id = t.school_id;

-- Từng TIẾT × người phụ trách: đã điểm danh chưa, và buổi đó đã chấm công chưa.
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
  (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session as work_session,
  u.id                as user_id,
  u.full_name,
  u.role              as user_role,
  a.role              as session_role,
  att.id              as attendance_id,
  att.checked_in_at   as class_check_in_at,
  att.roster_size,
  att.present_count,
  (att.id is not null) as attendance_done,
  t.id                as timesheet_id,
  t.check_in_at       as shift_check_in_at,
  t.check_out_at      as shift_check_out_at,
  coalesce(t.label, 'absent')::attend_label as shift_label
from schedules s
join schools sc on sc.id = s.school_id
join classes c  on c.id  = s.class_id
cross join lateral (
  values (s.teacher_id, 'teacher'::class_role), (s.assistant_id, 'assistant'::class_role)
) as a (user_id, role)
join users u on u.id = a.user_id
left join attendance att on att.schedule_id = s.id
left join timesheets t
       on t.user_id = a.user_id
      and t.school_id = s.school_id
      and t.work_date = s.session_date
      and t.work_session = (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session
where s.status <> 'cancelled';
