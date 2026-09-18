-- 012 — Giờ học theo MÙA cho từng trường · trạng thái tiết rõ ràng.

/* ----------------------- 1. GIỜ HỌC TỪNG TIẾT THEO MÙA ---------------------
 * Mỗi trường có thể có nhiều BỘ GIỜ HỌC, mỗi bộ áp dụng trong một khoảng ngày
 * (VD "Mùa hè 2026" 15/04–14/10, "Mùa đông 2026–27" 15/10–14/04). Ngày dạy rơi
 * vào bộ nào thì tiết lấy giờ theo bộ đó; không có bộ nào khớp thì dùng khung
 * chung của hệ thống (app_settings.periods).
 * Giờ của buổi dạy được CHỐT lúc xếp lịch, nên sửa bộ giờ về sau không làm xê
 * dịch bảng công của các buổi đã có.
 */
create table if not exists school_period_sets (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools (id) on delete cascade,
  name        text not null,
  valid_from  date not null,
  valid_to    date not null,
  is_active   boolean not null default true,
  note        text,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint school_period_sets_range_chk check (valid_to >= valid_from)
);
create index if not exists school_period_sets_lookup_idx
  on school_period_sets (school_id, valid_from, valid_to) where is_active;

create table if not exists school_period_times (
  set_id      uuid not null references school_period_sets (id) on delete cascade,
  no          smallint not null check (no between 1 and 30),
  start_time  time not null,
  end_time    time not null,
  primary key (set_id, no),
  constraint school_period_times_chk check (end_time > start_time)
);

comment on table school_period_sets is
  'Bộ giờ học theo mùa của một trường — Quản trị viên và Phòng chuyên môn quản lý.';

/* ------------------------ 2. TRẠNG THÁI TIẾT RÕ RÀNG ----------------------
 *   scheduled — theo lịch
 *   done      — đã dạy (đã điểm danh)
 *   cancelled — HUỶ LỊCH: kế hoạch thay đổi từ trước (nghỉ lễ, trường bận…)
 *   skipped   — ĐÃ BỎ: đến giờ nhưng tiết không diễn ra (GV vắng, lớp đi ngoại khoá…)
 * "Xoá hẳn" là xoá khỏi hệ thống (chỉ khi nhập nhầm, chưa có điểm danh/chấm công)
 * — vết còn lại nằm trong nhật ký thao tác.
 */
alter type schedule_status add value if not exists 'skipped';

alter table schedules
  add column if not exists status_reason     text,
  add column if not exists status_changed_by uuid references users (id) on delete set null,
  add column if not exists status_changed_at timestamptz;

comment on column schedules.status_reason is 'Lý do huỷ lịch / bỏ tiết — bắt buộc khi đổi sang cancelled/skipped.';

/* ----------------------- 3. VIEW ĐỐI CHIẾU TỪNG TIẾT ----------------------
 * Nay GIỮ LẠI cả tiết đã huỷ và đã bỏ, kèm lý do — để Phòng chuyên môn nhìn
 * một bảng là thấy đủ: tiết nào dạy, tiết nào bỏ, tiết nào huỷ, vì sao.
 */
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
  s.status::text      as status,
  s.status_reason,
  sb.full_name        as status_changed_by_name,
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
      and t.work_session = (case when s.start_time < '12:00' then 'morning' else 'afternoon' end)::work_session;
