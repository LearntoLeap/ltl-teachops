-- =============================================================================
-- 004 — Ảnh selfie khi chấm công + danh mục thiết bị đề xuất (gợi ý khai báo).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHẤM CÔNG: ảnh chân dung (selfie) xác minh đúng người có mặt tại lớp.
--    Ảnh thiết bị (check_in_photo_id) vẫn giữ nguyên, hai ảnh độc lập nhau.
-- ---------------------------------------------------------------------------
alter table timesheets
  add column if not exists check_in_selfie_id  uuid references files (id) on delete set null,
  add column if not exists check_out_selfie_id uuid references files (id) on delete set null;

comment on column timesheets.check_in_selfie_id is
  'Ảnh selfie đầu buổi — xác minh đúng người dạy có mặt tại trường';

-- ---------------------------------------------------------------------------
-- 2. THIẾT BỊ: danh mục ĐỀ XUẤT dùng chung toàn hệ thống.
--    Khi khai báo danh mục cho một phòng, Admin/PCM chọn từ đây rồi
--    tự nhập số lượng thực tế của phòng đó.
-- ---------------------------------------------------------------------------
create table if not exists device_suggestions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  category      text not null default 'other',   -- robotics | computer | av | other
  unit          text not null default 'bộ',
  default_qty   integer not null default 1,      -- số lượng gợi ý sẵn
  icon          text not null default '📦',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Danh mục chuẩn theo catalog sản phẩm LtL + thiết bị phụ trợ phòng STEM.
insert into device_suggestions (name, category, unit, default_qty, icon, sort_order) values
  -- Robotics / bộ kit
  ('uKIT EDU',            'robotics', 'bộ',    10, '🤖',  10),
  ('UGOT',                'robotics', 'bộ',     6, '🦾',  20),
  ('Yanshee',             'robotics', 'bộ',     2, '🧍',  30),
  ('Alpha 1E',            'robotics', 'bộ',     4, '🕺',  40),
  ('Stick''em',           'robotics', 'bộ',    10, '🧱',  50),
  ('Weeemake',            'robotics', 'bộ',     8, '⚙️',  60),
  ('EBD',                 'robotics', 'bộ',     8, '🔌',  70),
  -- Máy tính / thiết bị học tập
  ('Laptop',              'computer', 'chiếc',  8, '💻', 110),
  ('Máy tính bàn',        'computer', 'bộ',     8, '🖥️', 120),
  ('Tablet',              'computer', 'chiếc', 10, '📱', 130),
  ('Chuột máy tính',      'computer', 'chiếc',  8, '🖱️', 140),
  ('Bàn phím',            'computer', 'chiếc',  8, '⌨️', 150),
  ('Máy in 3D',           'computer', 'chiếc',  1, '🖨️', 160),
  -- Âm thanh / hình ảnh
  ('MAXHUB',              'av',       'chiếc',  1, '📺', 210),
  ('Máy chiếu',           'av',       'chiếc',  1, '📽️', 220),
  ('Loa',                 'av',       'chiếc',  2, '🔊', 230),
  ('Micro',               'av',       'chiếc',  2, '🎤', 240),
  ('Webcam',              'av',       'chiếc',  1, '📷', 250),
  ('Bảng tương tác',      'av',       'chiếc',  1, '🖼️', 260),
  -- Khác
  ('Bàn học sinh',        'other',    'chiếc', 20, '🪑', 310),
  ('Ghế học sinh',        'other',    'chiếc', 30, '💺', 320),
  ('Tủ đựng thiết bị',    'other',    'chiếc',  2, '🗄️', 330),
  ('Ổ cắm điện',          'other',    'chiếc',  4, '🔌', 340)
on conflict (name) do nothing;

create index if not exists device_suggestions_cat_idx
  on device_suggestions (category, sort_order) where is_active;
