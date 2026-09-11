-- =============================================================================
-- 005 — Đồng bộ ảnh/tài liệu lên Google Drive của tài khoản quản trị chính.
--
-- VPS vẫn là nơi lưu CHÍNH (app đọc ảnh từ đĩa VPS cho nhanh); Drive là bản sao
-- để ban giám đốc xem/tải trực tiếp trên Drive và làm nơi lưu trữ dài hạn.
-- =============================================================================

alter table files
  add column if not exists drive_file_id   text,
  add column if not exists drive_link      text,
  add column if not exists drive_synced_at timestamptz,
  add column if not exists drive_attempts  integer not null default 0,
  add column if not exists drive_error     text;

comment on column files.drive_file_id is
  'ID tệp trên Google Drive; null = chưa đồng bộ';

-- Hàng đợi đồng bộ: tệp chưa lên Drive, chưa thất bại quá nhiều lần.
create index if not exists files_drive_pending_idx
  on files (created_at)
  where drive_file_id is null and drive_attempts < 5;

-- Bộ nhớ thư mục đã tạo trên Drive để không phải hỏi lại Drive mỗi lần upload.
create table if not exists drive_folders (
  path       text primary key,      -- ví dụ 'Tiểu học Xuân Hoà/2026-09'
  folder_id  text not null,
  created_at timestamptz not null default now()
);
