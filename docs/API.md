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
| GET | `/` | admin, manager | Lọc `?role=&school_id=&q=&is_active=`. `?link=any` (kèm `school_id`): KHÔNG lọc bỏ người chưa gắn trường, chỉ trả thêm cờ `at_school` và xếp người ở trường lên đầu — dùng cho ô chọn người khi xếp lịch |
| POST | `/` | admin | Tạo tài khoản + sinh mật khẩu tạm + gửi email |
| GET | `/:id` | admin, manager | |
| PATCH | `/:id` | admin | Sửa tên/SĐT/vai trò/trạng thái |
| POST | `/:id/reset-password` | admin | Cấp lại mật khẩu tạm |
| DELETE | `/:id` | admin | Vô hiệu hoá (soft delete: `is_active=false`) |
| PUT | `/:id/schools` | admin | `{school_ids: []}` — phạm vi cho `manager` |
| GET | `/:id/classes` | admin, manager | Lớp đang phụ trách |
| PUT | `/:id/classes` | admin | `{class_ids: []}` — lớp phụ trách cho `teacher`/`assistant`. **Quyết định họ thấy trường/lớp nào trong app**: phạm vi GV/TG suy từ lớp được phân công; chưa gắn lớp thì không tự thêm được buổi dạy và không có buổi nào để chấm công |
| GET | `/:id/schedule` | admin, manager, chính chủ | Lịch cá nhân |

## 3. Trường / Lớp / Phòng

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET/POST | `/api/schools` | GET: mọi vai trò (đã lọc phạm vi) · POST: admin, manager | |
| GET/PATCH | `/api/schools/:id` | PATCH: admin, manager | Gồm `lat/lng/gps_radius_m/grace_minutes/device_slots`; `is_active` **chỉ admin** (ngừng / khôi phục) |
| GET | `/api/schools/:id/delete-impact` | admin, manager | `{can_hard_delete, blockers[], cleanup[], unlinked[]}` — xoá hẳn được không và mất những gì |
| DELETE | `/api/schools/:id` | **chỉ admin** | Mặc định ngừng sử dụng (`is_active=false`), khôi phục được; `?hard=1` xoá hẳn (mã trường dùng lại được ngay) — **409** nếu đã có buổi dạy / kiểm tra thiết bị / báo hỏng, **trừ** người có `record.forceDelete` |
| GET/POST | `/api/classes` | POST: admin, manager | `?school_id=&level=` |
| GET/PATCH | `/api/classes/:id` | PATCH: admin, manager | `is_active` để ngừng / khôi phục lớp |
| GET | `/api/classes/:id/delete-impact` | admin, manager | Như trên, cho lớp |
| DELETE | `/api/classes/:id` | admin, manager | Mặc định ngừng sử dụng, khôi phục được; `?hard=1` xoá hẳn — **409** nếu lớp đã có buổi dạy |
| PUT | `/api/classes/:id/assignments` | admin, manager | `{assignments:[{user_id, role}]}` |
| GET/POST | `/api/rooms` | POST: admin, manager | `?school_id=` |
| GET/PATCH/DELETE | `/api/rooms/:id` | | |
| POST | `/api/schools/batch` | admin, manager | Nhập bảng: `{rows:[{code, name, address?, province?, lat?, lng?, gps_radius_m?, grace_minutes?, contact_name?, contact_phone?}]}` (≤300 dòng) |
| GET | `/api/schools/batch-template` | admin, manager | Tệp Excel mẫu đúng thứ tự cột |
| POST | `/api/classes/batch` | admin, manager | Nhập bảng: `{rows:[{school_id, name, grade?, level?, roster_size?, note?, teacher_id?, assistant_id?}]}` (≤300 dòng) |
| GET | `/api/classes/batch-template` | admin, manager | Tệp Excel mẫu đúng thứ tự cột |

**Mục đã NGỪNG SỬ DỤNG không lọt vào ô chọn.** `GET /api/schools`, `/api/classes`,
`/api/rooms` mặc định chỉ trả mục `is_active = true`. Màn hình quản trị muốn xem lại để khôi
phục thì gửi `?include_inactive=1`. Xếp buổi vào trường/lớp/phòng đã ngừng bị chặn (422).
Mã trường của một trường đã ngừng vẫn chiếm chỗ — `POST /api/schools` trả 409 kèm câu nói rõ
là trường đó đang ngừng, gợi ý khôi phục / xoá hẳn / đổi mã.

Các endpoint nhập bảng trả `{created, items[], skipped:[{row, reason}]}` — dòng lỗi (trùng mã/tên,
thiếu thông tin, ngoài phạm vi…) bị bỏ qua kèm lý do, các dòng khác vẫn được tạo.
Lớp: không gửi `level` thì server tự suy từ `grade` (1-5 Tiểu học · 6-9 THCS · 10-12 THPT) — áp dụng cả `POST /api/classes`.

**Xoá trường / lớp — hai mức, cố ý tách bạch.** Mọi bảng nghiệp vụ trỏ về `schools`/`classes`
bằng khoá ngoại `on delete cascade`, nên xoá hẳn một trường đang vận hành sẽ kéo theo cả lịch
dạy, chấm công và điểm danh. Vì vậy `?hard=1` chỉ chạy khi `delete-impact` không còn
`blockers` — tức bản ghi chưa ai dùng tới, đúng trường hợp NHẬP SAI. Trường/lớp đã đi vào vận
hành chỉ ngừng sử dụng được (`is_active=false`), giữ nguyên lịch sử và bật lại bất cứ lúc nào.
Danh sách lọc bằng `?is_active=true` để ẩn phần đã ngừng.

## 4. Lịch dạy — `/api/schedules`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | mọi vai trò | `?from=&to=&school_id=&class_id=&user_id=&status=` |
| GET | `/today` | mọi vai trò | Tiết hôm nay của tôi + `work_session` + đã điểm danh chưa (`attendance_done`, `present_count`, `attendance_roster_size`) |
| POST | `/` | admin, manager · GV/TG (`schedule.selfCreate`) | Tạo một tiết. GV/TG tự thêm tiết BỊ THIẾU thì **bắt buộc** `reason` (≥10 ký tự) — lưu `self_added_reason`, đánh dấu `self_added`, ghi `self_added_at`, và báo ngay cho Phòng chuyên môn của trường |
| | | | Buổi dạy nhận `period` (tiết 1–10) thay cho `start_time`/`end_time`; và `teacher_manual_name`/`assistant_manual_name` cho người chưa có tài khoản |
| POST | `/bulk` | admin, manager | `{template, weekdays:[], from, to}` — sinh lịch lặp theo tuần |
| POST | `/batch` | admin, manager | Nhập bảng nhiều buổi khác nhau `{rows:[…]}` → `{created, skipped[]}` |
| GET/PATCH/DELETE | `/:id` | PATCH/DELETE: admin, manager | |

**Khung tiết — `GET /api/periods` (mọi vai trò) · `PUT /api/periods` (admin).**
Khung tiết lưu ở `app_settings.periods`, Quản trị viên sửa giờ và **thêm tiết** (tối đa 30,
khớp ràng buộc `schedules_period_chk`) ngay trong app — trường bán trú / ca tối không bị bó
trong 1–10. Đổi khung tiết KHÔNG động vào buổi đã xếp: giờ của chúng đã lưu từ lúc tạo, nên
bảng công không xê dịch về sau.

**Tiết dạy.** Gửi `period` thì server suy ra `start_time`/`end_time` theo khung tiết đang áp
dụng rồi lưu cả ba; tiết không có trong khung ⇒ 400. Vẫn nhận
`start_time`/`end_time` trực tiếp cho nhập bảng và buổi ngoài khung tiết; khi đó `period` = null.
Sửa `period` qua `PATCH` sẽ kéo giờ đổi theo.

**Người dạy chưa có tài khoản.** `teacher_manual_name` / `assistant_manual_name` là tên gõ tay,
dùng khi chưa cấp tài khoản (hay gặp với trợ giảng thời vụ, và với GV/TG tự thêm buổi vì họ
không có quyền xem danh bạ). Chọn được tài khoản thì server tự xoá tên gõ tay — một nguồn sự
thật. Mọi truy vấn trả `teacher_name`/`assistant_name` đều là
`coalesce(users.full_name, *_manual_name)`, nên lịch, điểm danh và báo cáo hiển thị như nhau.

**Tự thêm TIẾT bị thiếu.** Giáo viên/trợ giảng chỉ thêm được TIẾT (không phải cả buổi) cho
chính mình, trong phạm vi trường được phân công, và phải nêu lý do. Tiết vừa thêm xuất hiện
ngay ở `GET /api/schedules/today` và trong danh sách chờ điểm danh, nên giáo viên điểm danh
được luôn. Mọi nơi trả tiết đó đều kèm `self_added`, `self_added_reason` và `added_by_name`
để Phòng chuyên môn và Quản trị viên biết ai thêm, vì sao — căn cứ để quyết định có tính
công hay không.

**Giờ học theo MÙA của từng trường.** `GET /api/periods?school_id=&date=` trả khung tiết
áp dụng cho trường vào ngày đó, kèm `source` (`school` | `system`) và `set_name`. Mỗi trường
có nhiều bộ giờ, mỗi bộ hiệu lực trong một khoảng ngày (VD mùa hè 15/04–14/10, mùa đông
15/10–14/04); nhiều bộ chồng ngày thì bộ bắt đầu muộn nhất thắng; không bộ nào khớp thì
dùng khung chung. Quản lý bộ giờ (admin, Phòng chuyên môn — `org.manage`):
`GET/POST /api/schools/:id/period-sets`, `PUT/DELETE /api/period-sets/:id`, thân
`{name, valid_from, valid_to, items:[{no, start, end}]}`. Xếp tiết thì giờ được tra theo
**đúng ngày dạy** — lịch lặp tuần vắt qua hai mùa tự lấy đúng giờ từng mùa. Giờ được chốt
lúc xếp lịch, nên sửa/xoá bộ giờ không làm xê dịch bảng công các buổi đã có.

**Trạng thái tiết.** `scheduled` Theo lịch · `done` Đã dạy · `cancelled` **Huỷ lịch** (kế
hoạch thay đổi từ trước) · `skipped` **Đã bỏ** (đến giờ nhưng không diễn ra).
`POST /api/schedules/:id/status {status, reason}` (admin/manager) — huỷ/bỏ **bắt buộc lý do**,
lưu `status_reason`, `status_changed_by`, `status_changed_at` và báo cho người phụ trách;
`status: scheduled` để khôi phục. Tiết đã điểm danh không huỷ/bỏ được. Tiết huỷ/bỏ vẫn hiện
trong lịch và báo cáo `class-sessions.xlsx` (cột Trạng thái tiết + Lý do huỷ / bỏ).
`DELETE /api/schedules/:id` là **Xoá hẳn** (`?reason=` để ghi nhật ký):
- tiết **chưa điểm danh**: ai có `schedule.manage` cũng xoá được;
- tiết **đã điểm danh**: `409` với mọi người, **trừ** người có `record.forceDelete`
  (chỉ Quản trị viên) — xoá kéo theo bản điểm danh và chấm công gắn tiết đó,
  phản hồi trả `attendance_deleted`.

**Giao trợ giảng theo tiết.** Mỗi tiết có thể một trợ giảng khác nhau.
`GET /api/schedules/:id/assistant-options` và `PUT /api/schedules/:id/assistant
{assistant_id}` — giáo viên CỦA TIẾT tự giao được, admin/manager giao được mọi tiết. Người
được giao nhận thông báo, thấy tiết ở màn Điểm danh và check-in + điểm danh tiết đó. Tiết đã
điểm danh, đã huỷ hoặc đã bỏ thì không đổi người được.

## 5. Chấm công — `/api/timesheets`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | theo phạm vi | `?from=&to=&user_id=&school_id=&label=&approval_status=` |
| GET | `/my-shift` | teacher, assistant | `?school_id=&date=&session=morning\|afternoon` → `{item, date, session, school, planned, devices}` — `planned` là tiết đầu buổi, CHỈ để nhắc giờ; `devices = {catalog:[{catalog_id,name,unit,expected,room_name,icon}], suggestions:[{name,category,unit,icon}]}` |
| POST | `/check-in` | teacher, assistant | *(xem dưới)* |
| POST | `/check-out` | teacher, assistant | *(xem dưới)* |
| POST | `/:id/approve` | admin, manager | `{decision:'approved'\|'rejected', reason?}` |
| PATCH | `/:id` | admin | Sửa tay (ghi `audit_log`) |
| DELETE | `/:id` | `record.forceDelete` (**chỉ admin**) | Xoá hẳn một bản chấm công (`?reason=`) — dùng khi chấm nhầm người/nhầm buổi |
| GET | `/reconcile` | admin, manager | Bảng đối chiếu kế hoạch ↔ thực tế |

> **Chấm công là của BUỔI, không của tiết.** Giáo viên đến trường chấm công vào
> một lần, ra về chấm công ra một lần, cho mỗi ca sáng/chiều. Kiểm thiết bị đầu
> buổi và cuối buổi nằm ở đây. Khoá duy nhất: `(user_id, work_date, work_session,
> school_id)`. Lịch dạy chỉ dùng để NHẮC giờ và để tính "đến đúng giờ chưa" — so
> với tiết đầu tiên của buổi; buổi không có tiết nào vẫn chấm công được nhưng
> được đánh dấu `unscheduled` để Phòng chuyên môn soát lại.
>
> **Buổi của một tiết tính theo SỐ TIẾT**: tiết 1–5 là buổi sáng, tiết 6 trở đi
> là buổi chiều (hàm SQL `schedule_session(period, start_time)`; tiết cũ không
> có số tiết thì theo giờ, trước 12:00 là sáng). Tiết "huỷ lịch" và "đã bỏ"
> không tính vào lịch của buổi. `GET /my-shift` trả `planned.items` =
> danh sách tiết của buổi `[{id, period, class_name, start_time, end_time}]`.
>
> **Việc dạy từng tiết nằm ở điểm danh**: trong mỗi tiết, giáo viên CHECK TẠI LỚP
> và đếm sĩ số (`POST /api/attendance` — ghi `checked_in_at`, GPS, sĩ số có mặt).
> Điểm danh xong thì tiết chuyển sang `done`.

**`POST /check-in`** — `multipart/form-data`

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `school_id` | ✅ | Trường đang có mặt |
| `date`, `session` | — | Mặc định theo giờ Việt Nam hiện tại |
| `lat`, `lng`, `accuracy` | ✅ | Từ `navigator.geolocation` |
| `photo` | ✅ | Ảnh thiết bị đầu buổi |
| `selfie` | ✅ | Ảnh xác minh đúng người có mặt |
| `devices` | ✅ | Chuỗi JSON — số lượng THỰC TẾ từng loại: `[{name, qty, unit?, catalog_id?, expected?}]` (≤60 loại, `qty` nguyên 0–10000, không trùng tên). Server tự tính `check_in_device_count` = tổng |
| `device_count` | — | Chỉ dùng khi client cũ không gửi `devices` |
| `note` | ⚠️ | **Bắt buộc** nếu ngoài bán kính, thiếu → `422` |
| `client_time`, `queued_at` | — | Dùng cho bản ghi đồng bộ trễ |

Server tính `distance_m`, `late_minutes`, `label`, `gps_flagged`. Đã chấm công buổi đó rồi → `409`.

**`POST /check-out`** — `multipart/form-data`

`school_id`, `date`, `session`, `lat`, `lng`, `device_ok` (bool), `devices` (JSON như check-in — đếm lại từng loại), `photo` (tuỳ chọn), `damage_note` + `damage_photo` (**bắt buộc nếu `device_ok=false`**, thiếu → `422`), `note`.

Server so `devices` cuối buổi với đầu buổi theo tên loại (không phân biệt hoa thường): loại nào **ít hơn** là thiếu → bắt buộc `damage_note` ghi lý do (thiếu → `422` nêu rõ loại và số thiếu), lưu `check_out_devices`, `device_shortage = true`.
Khi `device_ok=false` hoặc thiếu thiết bị, server tự tạo `device_issues` (`source='checkout'`, mô tả gồm phần thiếu + lý do) và thông báo cho `manager` của trường.
Bảng chấm công (`/api/reports/timesheets.xlsx`) ghi chi tiết từng loại ở cột *Thiết bị đầu buổi / cuối buổi* và cột *Tình trạng thiết bị* (Thiếu · Có hỏng · Đủ, nguyên vẹn).

## 6. Điểm danh — `/api/attendance`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | theo phạm vi | `?from=&to=&school_id=&class_id=` |
| GET | `/pending` | admin, manager | Buổi quá giờ mà chưa điểm danh |
| POST | `/` | teacher, assistant | `multipart`: `schedule_id`, `present_count`, `roster_size` (sĩ số thực tế buổi đó), `photos[]` (≥1), `absent_names?`, `note?` |
| GET/PATCH | `/:id` | PATCH: người tạo trong 24h, hoặc admin/manager | |
| DELETE | `/:id` | `record.forceDelete` (**chỉ admin**) | Xoá hẳn bản điểm danh (`?reason=`); tiết trở lại `scheduled` để điểm danh lại |
| POST | `/:id/remind` | admin, manager | Gửi thông báo nhắc người phụ trách |

Server tự suy `class_id`, `school_id`, `marked_by` từ `schedule_id` — client **không** gửi.

**Sĩ số do giáo viên điền theo thực tế** ("26/30"): `present_count` / `roster_size`, không giới hạn theo sĩ số chuẩn của lớp (trần kỹ thuật 10 000 để chặn gõ nhầm). Chỉ chặn có mặt > sĩ số vừa điền (`422`). Client cũ không gửi `roster_size` ⇒ lấy max(sĩ số chuẩn của lớp, có mặt). Lớp chưa khai sĩ số chuẩn (0) được bổ sung bằng sĩ số giáo viên vừa đếm. PATCH nhận thêm `roster_size`. `GET /api/schedules/:id` trả `last_roster_size` (sĩ số lần điểm danh gần nhất của lớp) để gợi ý.

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
| PATCH | `/:id` | chủ sở hữu, hoặc admin/manager |
| DELETE | `/:id` | **chỉ admin/manager** (`material.delete`) — mặc định gỡ khỏi kho (`is_archived`), khôi phục được; `?hard=1` xoá hẳn bản ghi + tệp trên máy chủ và đưa bản trên Drive vào thùng rác |
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

**Xem trước trước khi tải — `?preview=1`.** Mọi endpoint `*.xlsx` ở trên nhận thêm
`preview=1`: thay vì trả tệp, chúng trả JSON
`{ file_name, limit, total, sheets: [{ name, title, subtitle, columns: [{header, key, align}], rows, total, shown }] }`.
Bản xem trước đi qua ĐÚNG bộ cột và ĐÚNG bộ dòng dùng để sinh tệp, nên không bao giờ lệch với
thứ tải về; mỗi sheet cắt sau 300 dòng (`shown`) nhưng vẫn báo `total` thật.
Quyền và phạm vi dữ liệu giữ nguyên như khi tải tệp (GV/TG chỉ thấy phần của mình).
Xem trước KHÔNG ghi `audit_log` hành động `export` — chỉ lần tải tệp thật mới ghi.

## 11. Thông báo — `/api/notifications`

`GET /` (`?unread=1`) · `GET /stream` (SSE, `?token=` trên query vì `EventSource` không gửi header) ·
`POST /:id/read` · `POST /read-all`.

## 12. Báo cáo & xuất Excel — `/api/reports`

| Path | Quyền | Nội dung |
|---|---|---|
| `GET /admin-overview` | **chỉ admin** | `series` (14 ngày: sessions/attended/ontime/late) + `month_mix` (ontime/late/absent) cho biểu đồ trang chủ · Quy mô tổ chức (`org`), nhân sự theo vai trò (`staff`), hàng đợi (`queues`), nhật ký + tài khoản mới (`recent_audit`, `recent_users`) |
| `GET /dashboard` | admin, manager | `series` + `month_mix` (theo phạm vi trường) · Số buổi hôm nay, tỉ lệ điểm danh, chấm công trễ, thiết bị hỏng mở, góp ý mới |
| `GET /my-dashboard` | teacher, assistant | `series` + `month_mix` (chỉ của mình) · `today_sessions` (MỌI tiết hôm nay kể cả huỷ/bỏ, kèm `period`, `work_session`, `school_id`, kết quả điểm danh), `today_shifts` (chấm công hôm nay theo trường × buổi), `pending_tasks`, `my_month` |
| `GET /timesheets.xlsx` | admin, manager · `teacher/assistant` chỉ dữ liệu của mình | Bảng chấm công theo tháng |
| `GET /payroll.xlsx` | admin, manager | Tổng hợp tính lương: số buổi, phút trễ, buổi vắng |
| `GET /class-sessions.xlsx` | admin, manager (`export.scope`) | **Lịch dạy & điểm danh theo TIẾT** — khớp đúng màn Lịch dạy và màn Điểm danh: tiết, giờ, lớp, người phụ trách, đã chấm công chưa, đã điểm danh chưa, giờ check tại lớp, sĩ số, và GV tự thêm / Người thêm / Lý do thêm |
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
| `material.delete` | ✅ | ✅ | — | — |
| `solution.manageRoot` | ✅ | — | — | — |
| `solution.manageChild` | ✅ | ✅ | — | — |
| `feedback.create` | ✅ | ✅ | ✅ | ✅ |
| `feedback.resolve` | ✅ | ✅ | — | — |
| `report.view` | ✅ | ✅ | — | — |
| `export.all` | ✅ | — | — | — |
| `export.scope` | ✅ | ✅ | — | — |
| `export.self` | ✅ | ✅ | ✅ | ✅ |
| `audit.view` | ✅ | — | — | — |
