-- 008 — Tiết dạy và tên người dạy nhập tay.
--
-- 1) period: xếp lịch theo TIẾT (1-10) thay vì gõ giờ. start_time/end_time vẫn
--    được suy ra và lưu lại vì chấm công tính trễ/sớm dựa trên chúng.
-- 2) teacher_manual_name / assistant_manual_name: tên gõ tay cho người CHƯA có
--    tài khoản. Không đặt tên cột là teacher_name vì tên đó đã là bí danh của
--    users.full_name trong hàng loạt truy vấn (lịch, điểm danh, báo cáo).
--    Các truy vấn đó nay dùng coalesce(u.full_name, s.*_manual_name).

alter table schedules
  add column if not exists period                smallint,
  add column if not exists teacher_manual_name   text,
  add column if not exists assistant_manual_name text;

alter table schedules
  drop constraint if exists schedules_period_chk;
alter table schedules
  add constraint schedules_period_chk check (period is null or (period between 1 and 10));

-- Buổi dạy phải xác định được người dạy: hoặc tài khoản, hoặc tên gõ tay.
-- (Không ép buộc ở mức bảng để giữ được dữ liệu lịch sử — kiểm ở tầng API.)
create index if not exists schedules_period_idx on schedules (session_date, period);

comment on column schedules.period is 'Tiết dạy 1-10; start_time/end_time suy ra từ khung tiết của trường.';
comment on column schedules.teacher_manual_name is 'Tên giáo viên gõ tay khi chưa có tài khoản trong hệ thống.';
comment on column schedules.assistant_manual_name is 'Tên trợ giảng gõ tay khi chưa có tài khoản trong hệ thống.';

-- View buổi chưa điểm danh: bổ sung tiết + tên gõ tay (thêm vào CUỐI danh sách
-- cột để "create or replace view" chấp nhận).
create or replace view v_attendance_pending as
select s.id as schedule_id, s.school_id, s.class_id, s.session_date, s.start_time,
       s.teacher_id, s.assistant_id,
       s.period, s.teacher_manual_name, s.assistant_manual_name
from schedules s
left join attendance a on a.schedule_id = s.id
where a.id is null
  and s.status = 'scheduled'
  and s.session_date <= current_date;
