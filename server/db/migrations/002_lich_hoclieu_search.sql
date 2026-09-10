-- =============================================================================
-- 002 — Lịch/tiết nối tiếp, học liệu chuyên sâu, tìm kiếm nhanh, giờ check-out.
-- Chạy bằng: node src/scripts/migrate.js (tự bỏ qua nếu đã áp dụng).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TRƯỜNG: giờ check-out linh hoạt — CHỈ Quản trị viên chỉnh (API kiểm soát).
--    Dùng cho nhắc check-out & đối chiếu công: quá end_time + grace ⇒ nhắc.
-- ---------------------------------------------------------------------------
alter table schools
  add column if not exists checkout_grace_minutes integer not null default 45;
alter table schools
  add constraint schools_checkout_chk check (checkout_grace_minutes between 5 and 240);

-- ---------------------------------------------------------------------------
-- 2. CHẤM CÔNG: tiết nối tiếp trong cùng buổi (sáng/chiều) — check-in rút gọn
--    không cần GPS/ảnh; ghi vết tiết đầu của buổi để đối chiếu.
-- ---------------------------------------------------------------------------
alter table timesheets
  add column if not exists linked_from uuid references timesheets (id) on delete set null;
comment on column timesheets.linked_from is
  'Tiết nối tiếp: trỏ về bản ghi check-in đầu buổi (sáng/chiều) cùng trường cùng ngày';

-- ---------------------------------------------------------------------------
-- 3. HỌC LIỆU: loại tài liệu (tự mở rộng) + gắn bài giảng + ảnh minh hoạ.
-- ---------------------------------------------------------------------------
create table if not exists material_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,           -- "Giáo án", "Slide giảng dạy"…
  icon       text not null default '📄',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into material_types (name, icon, sort_order) values
  ('Giáo án',            '📝', 10),
  ('Giáo trình',         '📘', 20),
  ('Slide giảng dạy',    '🖥️', 30),
  ('Nghiên cứu tài liệu','🔬', 40),
  ('Video bài dạy',      '🎬', 50)
on conflict (name) do nothing;

alter table materials add column if not exists grade         integer;
alter table materials add column if not exists type_id       uuid references material_types (id) on delete set null;
alter table materials add column if not exists lesson_no     integer;      -- tiết thứ mấy
alter table materials add column if not exists lesson_title  text;         -- tên bài
alter table materials add column if not exists curriculum    text;         -- chương trình học
alter table materials add column if not exists cover_file_id uuid references files (id) on delete set null;
alter table materials add column if not exists body          text;         -- nội dung tự do

alter table materials add constraint materials_grade_chk
  check (grade is null or grade between 1 and 12);
alter table materials add constraint materials_lesson_chk
  check (lesson_no is null or lesson_no between 1 and 500);

create index if not exists materials_grade_idx on materials (grade) where not is_archived;
create index if not exists materials_type_idx  on materials (type_id) where not is_archived;

-- ---------------------------------------------------------------------------
-- 4. TÌM KIẾM NHANH: pg_trgm tăng tốc ILIKE (nếu server không có contrib thì
--    bỏ qua êm — ILIKE vẫn chạy đúng, chỉ chậm hơn trên dữ liệu lớn).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_trgm;
    create index if not exists schools_name_trgm   on schools  using gin (name gin_trgm_ops);
    create index if not exists classes_name_trgm   on classes  using gin (name gin_trgm_ops);
    create index if not exists users_name_trgm     on users    using gin (full_name gin_trgm_ops);
    create index if not exists materials_title_trgm on materials using gin (title gin_trgm_ops);
    create index if not exists solutions_name_trgm on solutions using gin (name gin_trgm_ops);
  exception when others then
    raise notice 'pg_trgm không khả dụng — bỏ qua chỉ mục tìm kiếm: %', sqlerrm;
  end;
end $$;
