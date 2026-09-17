-- 009 — Khung tiết dạy cấu hình được: nới trần số tiết từ 10 lên 30.
--
-- Trường bán trú / trung tâm dạy thêm có thể cần hơn 10 tiết mỗi ngày. Khung
-- tiết thật nằm ở app_settings key 'periods' (Quản trị viên sửa trong app);
-- ràng buộc dưới đây chỉ là trần kỹ thuật, khớp MAX_PERIOD trong lib/periods.js.

alter table schedules drop constraint if exists schedules_period_chk;
alter table schedules
  add constraint schedules_period_chk check (period is null or (period between 1 and 30));

comment on column schedules.period is
  'Tiết dạy 1-30; khung giờ từng tiết cấu hình ở app_settings.periods.';
