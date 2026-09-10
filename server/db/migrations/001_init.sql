-- =============================================================================
-- LtL TeachOps — Lược đồ khởi tạo (PostgreSQL 16)
-- Chạy một lần khi container db khởi động lần đầu (docker-entrypoint-initdb.d).
-- Mọi thay đổi về sau viết thành file 002_*.sql, 003_*.sql — KHÔNG sửa file này.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ----------------------------------------------------------------------------
-- Kiểu liệt kê
-- ----------------------------------------------------------------------------
create type user_role         as enum ('admin', 'manager', 'teacher', 'assistant');
create type edu_level         as enum ('primary', 'secondary', 'highschool');
create type class_role        as enum ('teacher', 'assistant');
create type attend_label      as enum ('ontime', 'late', 'absent');
create type schedule_status   as enum ('scheduled', 'done', 'cancelled');
create type approval_status   as enum ('pending', 'approved', 'rejected');
create type issue_status      as enum ('new', 'in_progress', 'resolved');
create type feedback_category as enum ('curriculum', 'device', 'other');
create type priority_level    as enum ('low', 'normal', 'high', 'urgent');
create type material_area     as enum ('official', 'teacher');
create type device_slot       as enum ('morning_start', 'morning_end', 'afternoon_start', 'afternoon_end');
create type solution_group    as enum ('ubtech', 'stickem', 'weeemake', 'other');

-- Hàm tiện ích: tự cập nhật updated_at
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- 1. TÀI KHOẢN & PHÂN QUYỀN
-- =============================================================================
create table users (
  id                    uuid primary key default gen_random_uuid(),
  email                 citext not null unique,
  password_hash         text not null,
  full_name             text not null,
  phone                 text,
  role                  user_role not null,
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  avatar_file_id        uuid,
  last_login_at         timestamptz,
  created_by            uuid references users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index users_role_idx   on users (role) where is_active;
create index users_active_idx on users (is_active);
create trigger users_touch before update on users
  for each row execute function touch_updated_at();

-- Refresh token (lưu băm SHA-256, thu hồi được)
create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  user_agent  text,
  ip          inet,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id) where revoked_at is null;

-- Đặt lại mật khẩu qua email
create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_resets_user_idx on password_resets (user_id) where used_at is null;

-- =============================================================================
-- 2. TỔ CHỨC: TRƯỜNG · LỚP · PHÒNG STEM
-- =============================================================================
create table schools (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,               -- mã ngắn, ví dụ "THXH"
  name              text not null,
  address           text,
  province          text,
  lat               double precision,
  lng               double precision,
  gps_radius_m      integer not null default 1000,      -- bán kính cho phép check-in (chốt: 1km)
  grace_minutes     integer not null default 10,        -- trễ bao nhiêu phút vẫn tính đúng giờ
  device_slots      device_slot[] not null default
                      '{morning_start,morning_end,afternoon_start,afternoon_end}',
  contact_name      text,
  contact_phone     text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint schools_radius_chk check (gps_radius_m between 20 and 5000),
  constraint schools_grace_chk  check (grace_minutes between 0 and 120)
);
create index schools_active_idx on schools (is_active);
create trigger schools_touch before update on schools
  for each row execute function touch_updated_at();

-- Phạm vi phụ trách của Phòng chuyên môn
create table user_schools (
  user_id    uuid not null references users (id) on delete cascade,
  school_id  uuid not null references schools (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, school_id)
);
create index user_schools_school_idx on user_schools (school_id);

create table classes (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools (id) on delete cascade,
  name         text not null,                            -- "5A", "6/2"…
  level        edu_level not null,
  grade        integer,                                  -- khối: 1..12
  roster_size  integer not null default 0,               -- sĩ số chuẩn
  note         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (school_id, name),
  constraint classes_roster_chk check (roster_size between 0 and 200),
  constraint classes_grade_chk  check (grade is null or grade between 1 and 12)
);
create index classes_school_idx on classes (school_id) where is_active;
create trigger classes_touch before update on classes
  for each row execute function touch_updated_at();

-- Giáo viên / trợ giảng phụ trách lớp (do Phòng chuyên môn gán)
create table class_assignments (
  class_id    uuid not null references classes (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  role        class_role not null,
  created_at  timestamptz not null default now(),
  primary key (class_id, user_id, role)
);
create index class_assignments_user_idx on class_assignments (user_id);

create table stem_rooms (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools (id) on delete cascade,
  name       text not null,                              -- "Phòng STEM 1"
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);
create index stem_rooms_school_idx on stem_rooms (school_id) where is_active;
create trigger stem_rooms_touch before update on stem_rooms
  for each row execute function touch_updated_at();

-- =============================================================================
-- 3. TỆP ĐÍNH KÈM (ảnh, tài liệu) — lưu đường dẫn, KHÔNG lưu nội dung
-- =============================================================================
create table files (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null,                            -- tương đối so với UPLOAD_DIR
  file_name    text not null,                            -- tên gốc người dùng tải lên
  mime         text not null,
  size_bytes   bigint not null,
  sha256       text,
  width        integer,
  height       integer,
  uploaded_by  uuid references users (id) on delete set null,
  school_id    uuid references schools (id) on delete set null,  -- để soát quyền xem
  created_at   timestamptz not null default now()
);
create index files_uploader_idx on files (uploaded_by);
create index files_school_idx   on files (school_id);

alter table users
  add constraint users_avatar_fk foreign key (avatar_file_id) references files (id) on delete set null;

-- =============================================================================
-- 4. LỊCH DẠY & PHÂN CÔNG — "nguồn sự thật" cho chấm công/điểm danh
-- =============================================================================
create table schedules (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools (id) on delete cascade,
  class_id      uuid not null references classes (id) on delete cascade,
  room_id       uuid references stem_rooms (id) on delete set null,
  teacher_id    uuid references users (id) on delete set null,
  assistant_id  uuid references users (id) on delete set null,
  session_date  date not null,
  start_time    time not null,
  end_time      time not null,
  subject       text,                                    -- "Robotics — Bài 5"
  status        schedule_status not null default 'scheduled',
  note          text,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint schedules_time_chk check (end_time > start_time)
);
create index schedules_date_idx     on schedules (session_date);
create index schedules_school_idx   on schedules (school_id, session_date);
create index schedules_class_idx    on schedules (class_id, session_date);
create index schedules_teacher_idx  on schedules (teacher_id, session_date);
create index schedules_asst_idx     on schedules (assistant_id, session_date);
create trigger schedules_touch before update on schedules
  for each row execute function touch_updated_at();

-- Một người không thể có hai buổi trùng giờ (chặn ở tầng API, index hỗ trợ tra cứu)
create index schedules_teacher_slot_idx on schedules (teacher_id, session_date, start_time)
  where teacher_id is not null and status <> 'cancelled';

-- =============================================================================
-- 5. CHẤM CÔNG (check-in / check-out GPS)
-- =============================================================================
create table timesheets (
  id                 uuid primary key default gen_random_uuid(),
  schedule_id        uuid not null references schedules (id) on delete cascade,
  user_id            uuid not null references users (id) on delete cascade,
  role               class_role not null,                -- vai trò trong buổi này

  -- Check-in
  check_in_at        timestamptz,                        -- GIỜ SERVER
  check_in_lat       double precision,
  check_in_lng       double precision,
  check_in_accuracy  double precision,
  check_in_distance_m integer,
  check_in_photo_id  uuid references files (id) on delete set null,
  check_in_device_count integer,                         -- số thiết bị đếm tay đầu buổi
  check_in_note      text,
  gps_flagged        boolean not null default false,     -- ngoài bán kính → cần duyệt tay
  late_minutes       integer not null default 0,
  label              attend_label,                       -- ontime | late | absent

  -- Check-out
  check_out_at       timestamptz,
  check_out_lat      double precision,
  check_out_lng      double precision,
  check_out_distance_m integer,
  check_out_photo_id uuid references files (id) on delete set null,
  device_ok          boolean,                            -- thiết bị còn nguyên vẹn?
  damage_note        text,
  check_out_note     text,

  -- Đối chiếu & duyệt
  work_minutes       integer,                            -- tính khi check-out
  approval_status    approval_status not null default 'approved',
  approved_by        uuid references users (id) on delete set null,
  approved_at        timestamptz,
  reject_reason      text,

  -- Offline
  client_time        timestamptz,                        -- giờ máy người dùng khi thao tác
  queued_at          timestamptz,                        -- lúc đưa vào hàng đợi offline
  synced_late        boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (schedule_id, user_id)
);
create index timesheets_user_idx     on timesheets (user_id, check_in_at desc);
create index timesheets_schedule_idx on timesheets (schedule_id);
create index timesheets_pending_idx  on timesheets (approval_status) where approval_status = 'pending';
create trigger timesheets_touch before update on timesheets
  for each row execute function touch_updated_at();

-- =============================================================================
-- 6. ĐIỂM DANH HỌC SINH
-- =============================================================================
create table attendance (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references schedules (id) on delete cascade unique,
  class_id       uuid not null references classes (id) on delete cascade,
  school_id      uuid not null references schools (id) on delete cascade,
  marked_by      uuid not null references users (id) on delete restrict,
  roster_size    integer not null,                       -- snapshot sĩ số chuẩn lúc điểm danh
  present_count  integer not null,
  absent_names   text,                                   -- tuỳ chọn: danh sách HS vắng
  note           text,
  client_time    timestamptz,
  queued_at      timestamptz,
  synced_late    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint attendance_count_chk check (present_count >= 0 and present_count <= roster_size + 20)
);
create index attendance_school_idx on attendance (school_id, created_at desc);
create index attendance_class_idx  on attendance (class_id, created_at desc);
create trigger attendance_touch before update on attendance
  for each row execute function touch_updated_at();

create table attendance_photos (
  attendance_id uuid not null references attendance (id) on delete cascade,
  file_id       uuid not null references files (id) on delete cascade,
  sort_order    integer not null default 0,
  primary key (attendance_id, file_id)
);

-- =============================================================================
-- 7. THIẾT BỊ PHÒNG STEM
-- =============================================================================
create table device_catalog (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools (id) on delete cascade,
  room_id      uuid references stem_rooms (id) on delete cascade,
  name         text not null,                            -- "uKIT EDU", "UGOT", "Máy in 3D"…
  sku          text,
  unit         text not null default 'bộ',
  expected_qty integer not null default 0,
  note         text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index device_catalog_room_idx   on device_catalog (room_id) where is_active;
create index device_catalog_school_idx on device_catalog (school_id) where is_active;
create trigger device_catalog_touch before update on device_catalog
  for each row execute function touch_updated_at();

create table device_checks (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools (id) on delete cascade,
  room_id      uuid not null references stem_rooms (id) on delete cascade,
  check_date   date not null,
  slot         device_slot not null,
  user_id      uuid not null references users (id) on delete restrict,
  items        jsonb not null default '[]'::jsonb,       -- [{catalog_id, qty, note}]
  note         text,
  has_shortage boolean not null default false,           -- có mục lệch expected_qty
  client_time  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (room_id, check_date, slot)
);
create index device_checks_room_idx   on device_checks (room_id, check_date desc);
create index device_checks_school_idx on device_checks (school_id, check_date desc);
create trigger device_checks_touch before update on device_checks
  for each row execute function touch_updated_at();

create table device_check_photos (
  check_id   uuid not null references device_checks (id) on delete cascade,
  file_id    uuid not null references files (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (check_id, file_id)
);

create table device_issues (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools (id) on delete cascade,
  room_id     uuid references stem_rooms (id) on delete set null,
  catalog_id  uuid references device_catalog (id) on delete set null,
  device_name text not null,                             -- giữ tên kể cả khi catalog bị xoá
  quantity    integer not null default 1,
  description text not null,
  priority    priority_level not null default 'normal',
  status      issue_status not null default 'new',
  source      text not null default 'manual',            -- manual | checkout | device_check
  source_id   uuid,                                      -- id timesheet / device_check nguồn
  reported_by uuid not null references users (id) on delete restrict,
  assigned_to uuid references users (id) on delete set null,
  resolution  text,
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index device_issues_school_idx on device_issues (school_id, status, created_at desc);
create index device_issues_open_idx   on device_issues (status) where status <> 'resolved';
create trigger device_issues_touch before update on device_issues
  for each row execute function touch_updated_at();

create table device_issue_photos (
  issue_id   uuid not null references device_issues (id) on delete cascade,
  file_id    uuid not null references files (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (issue_id, file_id)
);

-- =============================================================================
-- 8. HỌC LIỆU (giáo án / giáo trình / slide)
-- =============================================================================
create table materials (
  id              uuid primary key default gen_random_uuid(),
  level           edu_level not null,
  area            material_area not null,                -- official | teacher
  title           text not null,
  subject         text,                                  -- "Robotics", "Tin học"…
  description     text,
  school_id       uuid references schools (id) on delete set null,
  class_id        uuid references classes (id) on delete set null,
  solution_id     uuid,                                  -- FK thêm sau khi có bảng solutions
  owner_id        uuid not null references users (id) on delete restrict,
  approval_status approval_status not null default 'pending',
  approved_by     uuid references users (id) on delete set null,
  approved_at     timestamptz,
  version_count   integer not null default 0,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index materials_browse_idx on materials (area, level, created_at desc) where not is_archived;
create index materials_owner_idx  on materials (owner_id);
create index materials_school_idx on materials (school_id);
create trigger materials_touch before update on materials
  for each row execute function touch_updated_at();

create table material_versions (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id) on delete cascade,
  version     integer not null,
  file_id     uuid not null references files (id) on delete restrict,
  change_note text,
  uploaded_by uuid not null references users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  unique (material_id, version)
);
create index material_versions_material_idx on material_versions (material_id, version desc);

create table material_comments (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id) on delete cascade,
  version_id  uuid references material_versions (id) on delete set null,
  user_id     uuid not null references users (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index material_comments_material_idx on material_comments (material_id, created_at);
create trigger material_comments_touch before update on material_comments
  for each row execute function touch_updated_at();

-- Đánh dấu ai đã đọc tài liệu nào (phục vụ badge "mới")
create table material_reads (
  material_id uuid not null references materials (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (material_id, user_id)
);

-- =============================================================================
-- 9. DANH MỤC GIẢI PHÁP
-- =============================================================================
create table solutions (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references solutions (id) on delete cascade,
  grp         solution_group not null,
  name        text not null,                             -- "uKIT EDU", "UGOT", "Stick'em"…
  level       edu_level,                                 -- null = dùng cho mọi cấp
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index solutions_group_idx  on solutions (grp, level) where is_active;
create index solutions_parent_idx on solutions (parent_id);
create trigger solutions_touch before update on solutions
  for each row execute function touch_updated_at();

alter table materials
  add constraint materials_solution_fk foreign key (solution_id) references solutions (id) on delete set null;

-- Tài liệu hướng dẫn + checklist thiết bị đi kèm mỗi giải pháp
create table solution_items (
  id          uuid primary key default gen_random_uuid(),
  solution_id uuid not null references solutions (id) on delete cascade,
  kind        text not null,                             -- doc | checklist
  label       text not null,
  file_id     uuid references files (id) on delete set null,
  qty         integer,
  note        text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index solution_items_solution_idx on solution_items (solution_id, sort_order);

-- =============================================================================
-- 10. GÓP Ý / PHẢN HỒI
-- =============================================================================
create table feedback (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools (id) on delete set null,
  class_id    uuid references classes (id) on delete set null,
  room_id     uuid references stem_rooms (id) on delete set null,
  material_id uuid references materials (id) on delete set null,
  category    feedback_category not null,
  priority    priority_level not null default 'normal',
  title       text not null,
  body        text not null,
  status      issue_status not null default 'new',
  created_by  uuid not null references users (id) on delete restrict,
  assigned_to uuid references users (id) on delete set null,
  closed_by   uuid references users (id) on delete set null,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index feedback_status_idx  on feedback (status, created_at desc);
create index feedback_school_idx  on feedback (school_id, created_at desc);
create index feedback_creator_idx on feedback (created_by, created_at desc);
create trigger feedback_touch before update on feedback
  for each row execute function touch_updated_at();

create table feedback_photos (
  feedback_id uuid not null references feedback (id) on delete cascade,
  file_id     uuid not null references files (id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (feedback_id, file_id)
);

create table feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedback (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  body        text not null,
  status_to   issue_status,                              -- nếu phản hồi kèm đổi trạng thái
  created_at  timestamptz not null default now()
);
create index feedback_replies_fb_idx on feedback_replies (feedback_id, created_at);

-- =============================================================================
-- 11. THÔNG BÁO
-- =============================================================================
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  kind       text not null,           -- material_new | feedback_reply | device_issue |
                                      -- attendance_missing | schedule_reminder | timesheet_flagged
  title      text not null,
  body       text,
  link       text,                    -- đường dẫn trong app, ví dụ /hoc-lieu/<id>
  ref_id     uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx   on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- =============================================================================
-- 12. NHẬT KÝ THAO TÁC
-- =============================================================================
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references users (id) on delete set null,
  actor_email text,                                     -- giữ lại kể cả khi user bị xoá
  action     text not null,                             -- create | update | delete | approve | login…
  entity     text not null,                             -- tên bảng
  entity_id  text,
  summary    text,
  before_data jsonb,
  after_data  jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity, entity_id, created_at desc);
create index audit_log_actor_idx  on audit_log (actor_id, created_at desc);
create index audit_log_time_idx   on audit_log (created_at desc);

-- =============================================================================
-- 13. KHUNG NHÌN TỔNG HỢP
-- =============================================================================

-- Đối chiếu kế hoạch (lịch) với thực tế (chấm công) — nền của bảng lương
create view v_timesheet_reconcile as
select
  s.id                as schedule_id,
  s.school_id,
  sc.name             as school_name,
  s.class_id,
  c.name              as class_name,
  s.session_date,
  s.start_time,
  s.end_time,
  u.id                as user_id,
  u.full_name,
  u.role              as user_role,
  a.role              as session_role,
  t.id                as timesheet_id,
  t.check_in_at,
  t.check_out_at,
  coalesce(t.label, 'absent')::attend_label as label,
  coalesce(t.late_minutes, 0)  as late_minutes,
  coalesce(t.work_minutes, 0)  as work_minutes,
  coalesce(t.gps_flagged, false) as gps_flagged,
  t.approval_status,
  (att.id is not null) as attendance_done
from schedules s
join schools sc on sc.id = s.school_id
join classes c  on c.id  = s.class_id
cross join lateral (
  values (s.teacher_id, 'teacher'::class_role), (s.assistant_id, 'assistant'::class_role)
) as a (user_id, role)
join users u on u.id = a.user_id
left join timesheets t on t.schedule_id = s.id and t.user_id = a.user_id
left join attendance att on att.schedule_id = s.id
where s.status <> 'cancelled';

-- Buổi chưa điểm danh (dashboard Phòng chuyên môn nhắc giáo viên)
create view v_attendance_pending as
select s.id as schedule_id, s.school_id, s.class_id, s.session_date, s.start_time,
       s.teacher_id, s.assistant_id
from schedules s
left join attendance a on a.schedule_id = s.id
where a.id is null
  and s.status = 'scheduled'
  and s.session_date <= current_date;

-- =============================================================================
-- 14. DỮ LIỆU KHỞI TẠO — danh mục giải pháp theo catalog LtL
-- =============================================================================
insert into solutions (grp, name, level, description, sort_order) values
  ('ubtech',   'UBTECH — uKIT EDU',  null, 'Bộ robot giáo dục uKIT EDU của UBTECH', 10),
  ('ubtech',   'UBTECH — UGOT',      null, 'Robot UGOT đa hình thái, AI thị giác',  20),
  ('ubtech',   'UBTECH — Yanshee',   null, 'Robot hình người Yanshee, lập trình Python/AI', 30),
  ('ubtech',   'UBTECH — Alpha 1E',  null, 'Robot hình người Alpha 1E',             40),
  ('stickem',  'Stick''em',          null, 'Bộ học liệu STEM Stick''em',            50),
  ('weeemake', 'Weeemake',           null, 'Bộ robotics Weeemake',                  60),
  ('other',    'EBD',                null, 'Bộ thiết bị EBD',                       70),
  ('other',    'Máy in 3D',          null, 'Máy in 3D phục vụ phòng STEM',          80),
  ('other',    'MAXHUB',             null, 'Màn hình tương tác MAXHUB',             90);
