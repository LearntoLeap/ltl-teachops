-- =============================================================================
-- 007 — Google Drive làm kho lưu trữ ảnh/video hiện trường + cấu hình trong app.
--
-- Ảnh/video của GV/TG (chấm công, điểm danh, kiểm kê, báo hỏng, góp ý) được đẩy
-- lên Drive; sau N ngày và khi đã xác minh bản trên Drive khớp md5, bản gốc trên
-- VPS bị xoá để giải phóng dung lượng (giữ lại ảnh thu nhỏ). App vẫn mở được tệp
-- gốc — máy chủ lấy từ Drive rồi chuyển tiếp cho người xem.
-- =============================================================================

alter table files
  add column if not exists drive_md5        text,
  add column if not exists local_deleted_at timestamptz;

comment on column files.local_deleted_at is
  'Đã xoá bản gốc khỏi VPS sau khi xác minh có trên Drive — phục vụ tệp qua Drive';

-- Hàng đợi dọn bản gốc: đã lên Drive nhưng VPS vẫn còn giữ.
create index if not exists files_offload_idx
  on files (created_at)
  where drive_file_id is not null and local_deleted_at is null;

-- Cấu hình hệ thống do Admin chỉnh trong app (vd. kết nối Google Drive).
-- Giá trị bí mật (client secret, refresh token) KHÔNG bao giờ trả ra API.
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now()
);
