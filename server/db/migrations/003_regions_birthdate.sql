-- =============================================================================
-- 003 — Khu vực công tác (danh mục mở, Admin thêm) + ngày sinh nhân sự.
-- =============================================================================

create table if not exists regions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,          -- "Hà Nội", "Thái Nguyên"…
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into regions (name, sort_order) values
  ('Hà Nội', 10),
  ('Thái Nguyên', 20)
on conflict (name) do nothing;

alter table users add column if not exists region_id  uuid references regions (id) on delete set null;
alter table users add column if not exists birth_date date;

create index if not exists users_region_idx on users (region_id) where is_active;
