# LtL TeachOps — Hợp đồng API

Base URL: `${VITE_API_URL}` (ví dụ `https://api.teachops.ltl.edu.vn`). Mọi route dưới `/api`.

## Quy ước chung

- Body & phản hồi: `application/json; charset=utf-8`. Tải tệp: `multipart/form-data`.
- Xác thực: `Authorization: Bearer <access_token>`.
- Phân trang: `?page=1&limit=50` → `{ items: [], total, page, limit }`. `limit` tối đa 200.
- Lỗi: `{ error: { code, message, details? } }` — `message` **tiếng Việt**, hiển thị thẳng cho người dùng.

| Mã HTTP | Ý nghĩa |
|---|---|
| `400` | Dữ liệu gửi lên sai định dạng |
| `401` | Thiếu / hết hạn token |
| `403` | Đúng người nhưng không đủ quyền cho hành động |
| `404` | Không tồn tại **hoặc ngoài phạm vi được xem** |
| `409` | Trùng dữ liệu (email, mã trường, đã check-in rồi…) |
| `413` | Tệp quá lớn |
| `422` | Vi phạm nghiệp vụ (ví dụ ngoài bán kính GPS mà không ghi chú) |
| `428` | `must_change_password = true` — buộc đổi mật khẩu trước |
| `429` | Quá số lần thử |

Mọi endpoint danh sách đều tự lọc theo phạm vi vai trò (xem `ARCHITECTURE.md` §3).

---

## 1. Xác thực — `/api/auth`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/login` | công khai | `{email, password}` → `{access_token, refresh_token, user, must_change_password}` |
| POST | `/refresh` | công khai | `{refresh_token}` → cặp token mới (xoay vòng refresh token) |
| POST | `/logout` | đăng nhập | Thu hồi refresh token hiện tại |
| GET | `/me` | đăng nhập | Hồ sơ + `schools[]` + `permissions[]` |
| POST | `/change-password` | đăng nhập | `{current_password, new_password}` — gỡ cờ `must_change_password` |
| POST | `/forgot-password` | công khai | `{email}` → luôn trả `204` (không lộ email có tồn tại) |
| POST | `/reset-password` | công khai | `{token, new_password}` |

> **Không có endpoint đăng ký.** Tài khoản chỉ do `admin` tạo.

## 2. Người dùng — `/api/users` (admin)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | admin, manager | Lọc `?role=&school_id=&q=&is_active=` |
| POST | `/` | admin | Tạo tài khoản + sinh mật khẩu tạm + gửi email |
| GET | `/:id` | admin, manager | |
| PATCH | `/:id` | admin | Sửa tên/SĐT/vai trò/trạng thái |
| POST | `/:id/reset-password` | admin | Cấp lại mật khẩu tạm |
| DELETE | `/:id` | admin | Vô hiệu hoá (soft delete: `is_active=false`) |
| PUT | `/:id/schools` | admin | `{school_ids: []}` — phạm vi cho `manager` |
| GET | `/:id/schedule` | admin, manager, chính chủ | Lịch cá nhân |

## 3. Trường / Lớp / Phòng

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET/POST | `/api/schools` | GET: mọi vai trò (đã lọc phạm vi) · POST: admin, manager | |
| GET/PATCH/DELETE | `/api/schools/:id` | PATCH/DELETE: admin, manager | Gồm `lat/lng/gps_radius_m/grace_minutes/device_slots` |
| GET/POST | `/api/classes` | POST: admin, manager | `?school_id=&level=` |
| GET/PATCH/DELETE | `/api/classes/:id` | | |
| PUT | `/api/classes/:id/assignments` | admin, manager | `{assignments:[{user_id, role}]}` |
| GET/POST | `/api/rooms` | POST: admin, manager | `?school_id=` |
| GET/PATCH/DELETE | `/api/rooms/:id` | | |
| POST | `/api/schools/batch` | admin, manager | Nhập bảng: `{rows:[{code, name, address?, province?, lat?, lng?, gps_radius_m?, grace_minutes?, contact_name?, contact_phone?}]}` (≤300 dòng) |
| GET | `/api/schools/batch-template` | admin, manager | Tệp Excel mẫu đúng thứ tự cột |
| POST | `/api/classes/batch` | admin, manager | Nhập bảng: `{rows:[{school_id, name, grade?, level?, roster_size?, note?, teacher_id?, assistant_id?}]}` (≤300 dòng) |
| GET | `/api/classes/batch-template` | admin, manager | Tệp Excel mẫu đúng thứ tự cột |

Các endpoint nhập bảng trả `{created, items[], skipped:[{row, reason}]}` — dòng lỗi (trùng mã/tên,
thiếu thông tin, ngoài phạm vi…) bị bỏ qua kèm lý do, các dòng khác vẫn được tạo.
Lớp: không gửi `level` thì server tự suy từ `grade` (1-5 Tiểu học · 6-9 THCS · 10-12 THPT) — áp dụng cả `POST /api/classes`.

## 4. Lịch dạy — `/api/schedules`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | mọi vai trò | `?from=&to=&school_id=&class_id=&user_id=&status=` |
| GET | `/today` | mọi vai trò | Buổi hôm nay của tôi + trạng thái chấm công/điểm danh |
| POST | `/` | admin, manager | Tạo một buổi |
| POST | `/bulk` | admin, manager | `{template, weekdays:[], from, to}` — sinh lịch lặp theo tuần |
| POST | `/batch` | admin, manager | Nhập bảng nhiều buổi khác nhau `{rows:[…]}` → `{created, skipped[]}` |
| GET/PATCH/DELETE | `/:id` | PATCH/DELETE: admin, manager | |

## 5. Chấm công — `/api/timesheets`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | theo phạm vi | `?from=&to=&user_id=&school_id=&label=&approval_status=` |
| GET | `/my/:schedule_id` | teacher, assistant | Trạng thái chấm công của tôi cho buổi đó |
| POST | `/check-in` | teacher, assistant | *(xem dưới)* |
| POST | `/check-out` | teacher, assistant | *(xem dưới)* |
| POST | `/:id/approve` | admin, manager | `{decision:'approved'\|'rejected', reason?}` |
| PATCH | `/:id` | admin | Sửa tay (ghi `audit_log`) |
| GET | `/reconcile` | admin, manager | Bảng đối chiếu kế hoạch ↔ thực tế |

**`POST /check-in`** — `multipart/form-data`

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `schedule_id` | ✅ | |
| `lat`, `lng`, `accuracy` | ✅ | Từ `navigator.geolocation` |
| `photo` | ✅ | Ảnh thiết bị đầu buổi |
| `device_count` | ✅ | Số thiết bị đếm tay |
| `note` | ⚠️ | **Bắt buộc** nếu ngoài bán kính, thiếu → `422` |
| `client_time`, `queued_at` | — | Dùng cho bản ghi đồng bộ trễ |

Server tính `distance_m`, `late_minutes`, `label`, `gps_flagged`. Đã check-in rồi → `409`.

> **Tiết nối tiếp trong buổi**: nếu người dạy ĐÃ check-in một tiết khác cùng buổi
> (sáng < 12:00 ≤ chiều) cùng trường cùng ngày, thì GPS và ảnh **không bắt buộc** —
> chỉ cần `device_count`; bản ghi lưu `linked_from` trỏ về tiết đầu, không gắn cờ GPS.
> `GET /my/:schedule_id` trả thêm `block_checked_in: boolean` để client hiện form rút gọn.

**`POST /check-out`** — `multipart/form-data`

`schedule_id`, `lat`, `lng`, `device_ok` (bool), `photo` (tuỳ chọn), `damage_note` + `damage_photo` (**bắt buộc nếu `device_ok=false`**, thiếu → `422`), `note`.
Khi `device_ok=false` server tự tạo `device_issues` (`source='checkout'`) và thông báo cho `manager` của trường.

## 6. Điểm danh — `/api/attendance`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | theo phạm vi | `?from=&to=&school_id=&class_id=` |
| GET | `/pending` | admin, manager | Buổi quá giờ mà chưa điểm danh |
| POST | `/` | teacher, assistant | `multipart`: `schedule_id`, `present_count`, `photos[]` (≥1), `absent_names?`, `note?` |
| GET/PATCH | `/:id` | PATCH: người tạo trong 24h, hoặc admin/manager | |
| POST | `/:id/remind` | admin, manager | Gửi thông báo nhắc người phụ trách |

Server tự suy `class_id`, `school_id`, `roster_size`, `marked_by` từ `schedule_id` — client **không** gửi.

## 7. Thiết bị — `/api/devices`

| Method | Path | Quyền |
|---|---|---|
| GET/POST | `/catalog` | POST: admin, manager |
| PATCH/DELETE | `/catalog/:id` | admin, manager |
| GET | `/checks` | theo phạm vi — `?room_id=&date=&slot=` |
| POST | `/checks` | teacher, assistant, manager — `multipart`: `room_id`, `slot`, `items` (JSON), `photos[]`, `note?` |
| GET | `/issues` | theo phạm vi — `?status=&school_id=&priority=` |
| POST | `/issues` | mọi vai trò |
| PATCH | `/issues/:id` | admin, manager — đổi `status`, `assigned_to`, `resolution` |

## 8. Học liệu — `/api/materials`

| Method | Path | Quyền |
|---|---|---|
| GET | `/` | mọi vai trò — `?area=&level=&subject=&school_id=&class_id=&q=&sort=`. `sort`: `moi-nhat` (mặc định) · `tiet` (khối → môn → tiết → loại) · `khoi` · `ten` (A→Z) · `loai` · `cu-nhat`. Mỗi mục trả `latest_version.mime` để client biết có xem trước được không |
| POST | `/` | `area=official`: admin, manager · `area=teacher`: mọi vai trò |
| GET | `/:id` | mọi vai trò (có `versions[]`, `comments[]`) |
| PATCH/DELETE | `/:id` | chủ sở hữu, hoặc admin/manager. `DELETE` mặc định gỡ khỏi kho (`is_archived`), khôi phục được; `DELETE /:id?hard=1` (admin/manager) xoá hẳn bản ghi + tệp trên máy chủ và đưa bản trên Drive vào thùng rác |
| POST | `/:id/versions` | chủ sở hữu, hoặc admin/manager — `multipart`: `file`, `change_note?` |
| POST | `/:id/approve` | admin, manager — `{decision, note?}` |
| GET/POST | `/:id/comments` | mọi vai trò trong phạm vi |
| POST | `/:id/read` | mọi vai trò — đánh dấu đã đọc |

Tải xuống qua `GET /api/files/:id` (route kiểm quyền).

**Trường mở rộng (002)**: `grade` (1-12) · `type_id` (loại tài liệu) · `lesson_no` – `lesson_title` –
`curriculum` (tiết – tên bài – chương trình học) · `body` (nội dung tự do — có body thì `file` không bắt buộc)
· `cover` (multipart, ảnh minh hoạ). Lọc thêm: `?grade=&type_id=`.

| Method | Path | Quyền |
|---|---|---|
| GET | `/api/materials/types` | mọi vai trò — danh sách loại (Giáo án, Giáo trình, Slide, Nghiên cứu, Video…) |
| POST | `/api/materials/types` | admin, manager — thêm loại mới `{name, icon?}` |

**Lọc theo giải pháp**: `solution_id` là giải pháp gốc ⇒ gồm luôn học liệu của các giải pháp con.
Lọc nhiều loại cùng lúc: `?type_ids=a,b`.

**Đăng hàng loạt** (màn hình dạng bảng): gọi `POST /api/materials` cho từng tệp kèm `batch=1`
(không gửi thông báo từng tệp), xong gọi `POST /api/materials/batch-done {ids}` — server gửi
MỘT thông báo tổng hợp theo cấp học cho GV/TG (chỉ tính học liệu chuẩn do chính người gọi đăng trong 1 ngày).

**Tải về .zip**

| Method | Path | Quyền |
|---|---|---|
| GET | `/api/materials/zip/preview` | mọi vai trò — cùng bộ lọc danh sách + `ids=a,b` (mục đã chọn) + `type_ids=` → `{count, file_count, text_count, total_bytes, too_many, too_large}` |
| GET | `/api/materials/zip` | mọi vai trò — như trên + `group=type\|lesson`; nhận token qua `?token=` để trình duyệt tự tải |

Cây thư mục: `Giải pháp / [Giải pháp con] / Khối 06 / <Loại> / Tiết 05 - Tên bài - Tiêu đề.pdf`
(`group=lesson`: `… / Khối 06 / Tiết 05 - Tên bài / <Loại> - Tiêu đề.pdf`). Lấy tệp phiên bản mới nhất;
bài viết không kèm tệp ⇒ `.txt`. Kèm `00 - Danh muc hoc lieu.xlsx`. Giới hạn 500 tài liệu / 1 GB mỗi lần.
Chỉ đóng gói học liệu người gọi được xem (cùng quy tắc với danh sách); ghi `audit_log` hành động `export`.

## 8b. Tìm kiếm nhanh — `/api/search`

`GET /api/search?q=` (≥2 ký tự) → `{schools, classes, users, materials, solutions, schedules}` —
mỗi nhóm tối đa 5 dòng, đã lọc theo phạm vi vai trò; `users` chỉ trả cho admin/manager.

## 9. Giải pháp — `/api/solutions`

`GET /` (cây, `?grp=&level=`) · `POST /`, `PATCH /:id`, `DELETE /:id` (admin; `manager` tạo được mục con,
mục **cấp gốc** mới cần admin) · `GET/POST /:id/items`, `PATCH/DELETE /items/:itemId`.

## 10. Góp ý — `/api/feedback`

`GET /` (`?status=&category=&school_id=&priority=&mine=1`) · `POST /` (`multipart`, mọi vai trò) ·
`GET /:id` · `PATCH /:id` (admin, manager — `status`, `assigned_to`, `priority`) ·
`POST /:id/replies` (mọi vai trò trong phạm vi; kèm `status_to` thì chỉ admin/manager).

## 11. Thông báo — `/api/notifications`

`GET /` (`?unread=1`) · `GET /stream` (SSE, `?token=` trên query vì `EventSource` không gửi header) ·
`POST /:id/read` · `POST /read-all`.

## 12. Báo cáo & xuất Excel — `/api/reports`

| Path | Quyền | Nội dung |
|---|---|---|
| `GET /admin-overview` | **chỉ admin** | Quy mô tổ chức (`org`), nhân sự theo vai trò (`staff`), hàng đợi (`queues`), nhật ký + tài khoản mới (`recent_audit`, `recent_users`) |
| `GET /dashboard` | admin, manager | Số buổi hôm nay, tỉ lệ điểm danh, chấm công trễ, thiết bị hỏng mở, góp ý mới |
| `GET /my-dashboard` | teacher, assistant | Lịch hôm nay + việc cần làm |
| `GET /timesheets.xlsx` | admin, manager · `teacher/assistant` chỉ dữ liệu của mình | Bảng chấm công theo tháng |
| `GET /payroll.xlsx` | admin, manager | Tổng hợp tính lương: số buổi, phút trễ, buổi vắng |
| `GET /attendance.xlsx` | theo phạm vi | |
| `GET /devices.xlsx` | theo phạm vi | |
| `GET /feedback.xlsx` | theo phạm vi | |
| `GET /users.xlsx` | admin | |

Mọi endpoint `.xlsx` nhận `?from=&to=&school_id=&class_id=&user_id=`.

## 13. Tệp — `/api/files`

`POST /` (`multipart`, tối đa 15MB/tệp — ảnh `jpeg/png/webp/heic`, tài liệu `pdf/docx/pptx/xlsx`) →
`{id, url, mime, size_bytes}` · `GET /:id` (kiểm quyền rồi stream; hỗ trợ `Range` → `206` để tua video)
· `GET /:id/thumb` (ảnh thu nhỏ 480px, cache 1 năm; video ⇒ ảnh bìa SVG có nút ▶).

Ảnh được nén phía client xuống cạnh dài ≤ 1600px, JPEG chất lượng 0.8 trước khi tải lên.

Video và tài liệu được ghi luồng thẳng xuống đĩa. Giới hạn: ảnh 15MB (`MAX_UPLOAD_MB`), video minh chứng 100MB
(`MAX_VIDEO_MB`), **học liệu 500MB** (`MAX_MATERIAL_MB`, cả tài liệu lẫn video, ở `POST /api/materials` + `/:id/versions`).

**Video** (`mp4/mov/webm/3gp/m4v`) chỉ được nhận ở:
`POST /api/attendance` + `PATCH /api/attendance/:id` (`photos`), `POST /api/devices/issues`,
`POST /api/feedback`, `POST /api/materials` + `/:id/versions`. Nơi khác gửi video ⇒ `400`.

Tệp đã chuyển hẳn sang Google Drive (`local_deleted_at`): `GET /:id` lấy từ Drive rồi chuyển tiếp
(kể cả `Range`); Drive không truy cập được ⇒ `503`.

## 13b. Google Drive — `/api/drive` (quyền `drive.manage` = admin)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/drive` | Trạng thái + cấu hình: `connected, account, root_folder_link, total, synced, pending, failed, offloaded, offloaded_bytes, local_bytes, keep_local_days, offload, redirect_uri…` (không bao giờ trả secret/token) |
| PUT | `/api/drive/config` | `{client_id, client_secret}` — OAuth client (Web application). Đã có tệp chỉ nằm trên Drive ⇒ không cho đổi client khác (`409`) |
| GET | `/api/drive/connect` | → `{url}` trang đăng nhập Google (scope `drive.file`, `state` = JWT 15 phút) |
| GET | `/api/drive/oauth/callback` | **Công khai** — Google chuyển về; đổi mã lấy refresh token, tạo thư mục gốc, chuyển về `APP_PUBLIC_URL/luu-tru-drive?ket_noi=ok\|loi&ly_do=` |
| POST | `/api/drive/disconnect` | Thu hồi quyền; tệp trên Drive giữ nguyên |
| PATCH | `/api/drive/settings` | `{keep_local_days (0-365), offload (bool), offload_materials (bool), material_min_mb (1-1000)}` |
| POST | `/api/drive/sync` | Đẩy ngay tối đa 100 tệp + dọn bản gốc đủ hạn → `{sync, offload, status}` |

Job nền (mỗi `DRIVE_SYNC_MINUTES`): đẩy tệp mới quá 2 phút theo cây `<Trường>/<YYYY-MM>/<Nghiệp vụ>`,
rồi xoá bản gốc trên VPS của: (a) ảnh/video hiện trường quá `keep_local_days` ngày, (b) tệp học liệu
từ `material_min_mb` MB trở lên khi `offload_materials` bật — chỉ khi Drive xác nhận md5 khớp và tệp chưa
vào thùng rác (không thì đưa lại hàng đợi đẩy). Ảnh bìa, ảnh đại diện, tệp giải pháp không bị dọn.
`GET /api/materials/zip` tự lấy lại các tệp đã chuyển từ Drive khi đóng gói. Xem docs/HUONG_DAN_GOOGLE_DRIVE.md.

## 14. Nhật ký — `/api/audit` (admin)

`GET /` — `?entity=&entity_id=&actor_id=&from=&to=&action=`.

---

## Ma trận quyền (đối chiếu Mục 3 bản yêu cầu)

Nguồn duy nhất: `server/src/lib/rbac.js`. Frontend đọc `permissions[]` từ `GET /api/auth/me` để ẩn/hiện nút,
nhưng **quyết định cuối luôn ở server**.

| Khoá quyền | admin | manager | teacher | assistant |
|---|:---:|:---:|:---:|:---:|
| `users.manage` | ✅ | — | — | — |
| `org.manage` (trường/lớp/phòng) | ✅ | ✅ | — | — |
| `schedule.manage` | ✅ | ✅ | — | — |
| `timesheet.self` | ✅ | ✅ | ✅ | ✅ |
| `timesheet.viewAll` | ✅ | ✅ | — | — |
| `timesheet.edit` | ✅ | — | — | — |
| `timesheet.approve` | ✅ | ✅ | — | — |
| `attendance.submit` | ✅ | ✅ | ✅ | ✅ |
| `attendance.viewAll` | ✅ | ✅ | — | — |
| `device.check` | ✅ | ✅ | ✅ | ✅ |
| `device.catalog` | ✅ | ✅ | — | — |
| `device.resolveIssue` | ✅ | ✅ | — | — |
| `material.official.write` | ✅ | ✅ | — | — |
| `material.teacher.write` | ✅ | ✅ | ✅ | ✅ |
| `material.approve` | ✅ | ✅ | — | — |
| `solution.manageRoot` | ✅ | — | — | — |
| `solution.manageChild` | ✅ | ✅ | — | — |
| `feedback.create` | ✅ | ✅ | ✅ | ✅ |
| `feedback.resolve` | ✅ | ✅ | — | — |
| `report.view` | ✅ | ✅ | — | — |
| `export.all` | ✅ | — | — | — |
| `export.scope` | ✅ | ✅ | — | — |
| `export.self` | ✅ | ✅ | ✅ | ✅ |
| `audit.view` | ✅ | — | — | — |
