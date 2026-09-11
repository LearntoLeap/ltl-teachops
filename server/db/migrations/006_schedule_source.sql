-- =============================================================================
-- 006 — Phân biệt buổi do GIÁO VIÊN tự thêm với buổi do Phòng chuyên môn xếp.
--
-- Lý do: giáo viên được tự thêm buổi bị thiếu để kịp chấm công/điểm danh, nhưng
-- Phòng chuyên môn cần nhìn ra ngay đâu là buổi mình xếp, đâu là buổi giáo viên
-- tự khai để còn rà soát trước khi tính lương.
-- =============================================================================

alter table schedules
  add column if not exists self_added boolean not null default false;

comment on column schedules.self_added is
  'true = giáo viên/trợ giảng tự thêm buổi bị thiếu; false = Phòng chuyên môn/Admin xếp lịch';

-- Buổi tự thêm cần rà soát nên hay được lọc riêng.
create index if not exists schedules_self_added_idx
  on schedules (session_date) where self_added;
