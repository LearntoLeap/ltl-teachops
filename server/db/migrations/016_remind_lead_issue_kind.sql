-- 016 — Nhắc chấm công trước giờ dạy (đặt trong cài đặt trường) + phân loại phiếu thiết bị.
--
-- 1. Trước đây jobs.remindUpcoming nhắc cố định 60 phút trước giờ vào lớp. Nay
--    mỗi trường tự đặt: trường ở xa cần báo sớm, trường gần thì 15–30 phút là đủ.
-- 2. Mục Thiết bị bỏ phần kiểm kê (việc đó đã nằm trong Chấm công đầu/cuối buổi),
--    chỉ còn BÁO HỎNG đột xuất và ĐỀ NGHỊ BỔ SUNG (cần mua thêm). Một lần báo
--    nhiều thiết bị ⇒ mỗi thiết bị một dòng, chung batch_id để hiện theo nhóm.

/* ------------------- 1. Nhắc trước giờ dạy, theo trường ------------------- */
alter table schools
  add column if not exists remind_before_minutes integer not null default 60;

alter table schools drop constraint if exists schools_remind_chk;
alter table schools
  add constraint schools_remind_chk check (remind_before_minutes between 5 and 240);

comment on column schools.remind_before_minutes is
  'Báo "sắp tới giờ dạy" trước giờ vào lớp bao nhiêu phút (5–240, mặc định 60).';

/* --------------------- 2. Phân loại phiếu thiết bị ----------------------- */
alter table device_issues
  add column if not exists kind text not null default 'broken';

alter table device_issues drop constraint if exists device_issues_kind_chk;
alter table device_issues
  add constraint device_issues_kind_chk check (kind in ('broken', 'restock'));

comment on column device_issues.kind is
  'broken = báo hỏng · restock = đề nghị bổ sung / cần mua thêm.';

alter table device_issues
  add column if not exists batch_id uuid;

create index if not exists device_issues_batch_idx
  on device_issues (batch_id) where batch_id is not null;

comment on column device_issues.batch_id is
  'Cùng một lần báo nhiều thiết bị thì các dòng dùng chung batch_id.';
