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

## 4. Lịch dạy — `/api/schedules`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | mọi vai trò | `?from=&to=&school_id=&class_id=&user_id=&status=` |
| GET | `/today` | mọi vai trò | Buổi hôm nay của tôi + trạng thái chấm công/điểm danh |
| POST | `/` | admin, manager | Tạo một buổi |
| POST | `/bulk` | admin, manager | `{template, weekdays:[], from, to}` — sinh lịch lặp theo tuần |
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
| GET | `/` | mọi vai trò — `?area=&level=&subject=&school_id=&class_id=&q=` |
| POST | `/` | `area=official`: admin, manager · `area=teacher`: mọi vai trò |
| GET | `/:id` | mọi vai trò (có `versions[]`, `comments[]`) |
| PATCH/DELETE | `/:id` | chủ sở hữu, hoặc admin/manager |
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
`{id, url, mime, size_bytes}` · `GET /:id` (kiểm quyền rồi stream) ·
`GET /:id/thumb` (ảnh thu nhỏ 480px, cache 1 năm).

Ảnh được nén phía client xuống cạnh dài ≤ 1600px, JPEG chất lượng 0.8 trước khi tải lên.

## 13b. Sao lưu Google Drive — `/api/reports/drive` (admin)

`GET /api/reports/drive` → `{enabled, total, synced, pending, failed, last_synced_at, last_error}`
· `POST /api/reports/drive/sync` — đẩy ngay tối đa 50 tệp, không chờ job nền (5 phút/lượt).

Ảnh vẫn lưu chính trên VPS; Drive là bản sao. Chưa cấu hình 4 biến GOOGLE_* thì `enabled=false`
và hệ thống bỏ qua đồng bộ. Xem docs/HUONG_DAN_GOOGLE_DRIVE.md.

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
