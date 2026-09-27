-- 015 — Mã trường / tên lớp chỉ phải duy nhất trong phần ĐANG DÙNG.
--
-- Trước đây trường "ngừng sử dụng" vẫn giữ mã, nên nhập lại đúng mã cũ là báo
-- trùng — người dùng phải bịa thêm ký tự (XHH… → XHHH… → XHHHH…). Nay ràng buộc
-- chỉ áp cho bản ghi is_active, bản đã ngừng không chiếm mã nữa.
-- Khôi phục một bản ghi đã ngừng sẽ bị chặn ở tầng ứng dụng nếu mã đang có người dùng.

/* ------------------------------- Trường ------------------------------- */
alter table schools drop constraint if exists schools_code_key;
drop index if exists schools_code_active_uq;
create unique index schools_code_active_uq on schools (code) where is_active;

comment on column schools.code is
  'Mã trường; chỉ duy nhất trong các trường đang dùng (is_active).';

/* -------------------------------- Lớp --------------------------------- */
alter table classes drop constraint if exists classes_school_id_name_key;
drop index if exists classes_name_active_uq;
create unique index classes_name_active_uq on classes (school_id, name) where is_active;

comment on column classes.name is
  'Tên lớp; chỉ duy nhất trong các lớp đang dùng của cùng trường.';
