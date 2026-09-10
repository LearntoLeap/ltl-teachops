# LtL TeachOps — Kiến trúc hệ thống

> Hệ thống quản lý vận hành giáo viên & trợ giảng — Công ty CP Công nghệ Giáo dục Learn to Leap.
> Tài liệu này là **nguồn sự thật** cho toàn bộ codebase. Mọi module phải tuân theo tên bảng,
> tên vai trò, quy tắc phân quyền và hợp đồng API mô tả ở đây.

---

## 1. Tổng thể triển khai

```
┌──────────────────────────┐         HTTPS/JSON          ┌───────────────────────────────┐
│  web/  React+Vite+PWA    │  ───────────────────────►   │  VPS 4GB · Docker Compose      │
│  Deploy: Vercel          │  ◄───────────────────────   │  ┌──────────────────────────┐ │
│  ltl-teachops.vercel.app │      JWT Bearer + SSE       │  │ caddy   :80/:443 TLS     │ │
└──────────────────────────┘                             │  ├──────────────────────────┤ │
                                                          │  │ api   Fastify :3000      │ │
       IndexedDB (offline queue)                          │  ├──────────────────────────┤ │
       ảnh + form chờ đồng bộ                             │  │ db    Postgres 16 :5432  │ │
                                                          │  └──────────────────────────┘ │
                                                          │  volume: /data/uploads, pgdata│
                                                          └───────────────────────────────┘
```

- **Frontend** không giữ bí mật. Chỉ có `VITE_API_URL` trỏ tới API trên VPS.
- **Ảnh** (lớp học, thiết bị, minh chứng, học liệu) lưu ở volume `/data/uploads` trên VPS,
  phục vụ qua route `/files/:id` có kiểm tra quyền — **không** lưu base64 trong DB.
- **Realtime**: SSE (`GET /api/notifications/stream`) — đủ cho thông báo tài liệu mới,
  phản hồi góp ý, nhắc điểm danh. Không cần WebSocket hai chiều.

## 2. Vai trò & mã vai trò

| Mã (DB/API) | Tên hiển thị      | Ghi chú |
|-------------|-------------------|---------|
| `admin`     | Quản trị viên     | Toàn quyền, tạo tài khoản |
| `manager`   | Phòng chuyên môn  | Phạm vi = các trường được gán trong `user_schools` |
| `teacher`   | Giáo viên         | Phạm vi = lớp/buổi được phân công |
| `assistant` | Trợ giảng         | Như `teacher` nhưng không đăng học liệu chuẩn, không sắp lịch |

> Vai trò `assistant` là bổ sung theo Mục 3 của bản yêu cầu — **cần Ban lãnh đạo xác nhận**.
> Toàn bộ quyền của `assistant` được cấu hình tập trung tại `server/src/lib/rbac.js`,
> đổi quyền chỉ sửa một chỗ.

## 3. Quy tắc phạm vi dữ liệu (row-level scoping)

Áp dụng ở tầng API (`server/src/lib/scope.js`). **Mọi** truy vấn danh sách phải đi qua đây.

| Vai trò | Trường (`schools`) | Lớp (`classes`) | Buổi (`schedules`) | Chấm công | Điểm danh | Thiết bị |
|---|---|---|---|---|---|---|
| `admin` | tất cả | tất cả | tất cả | tất cả | tất cả | tất cả |
| `manager` | `school_id IN (user_schools)` | thuộc trường trong phạm vi | thuộc trường trong phạm vi | thuộc trường trong phạm vi | thuộc trường trong phạm vi | thuộc trường trong phạm vi |
| `teacher` / `assistant` | trường có buổi được phân công | lớp có trong `class_assignments` | `teacher_id = me OR assistant_id = me` | `user_id = me` | buổi của mình | phòng của buổi mình dạy |

Nguyên tắc bắt buộc:
1. Không bao giờ tin `school_id` / `class_id` do client gửi lên — luôn suy ra từ bản ghi trong DB
   rồi đối chiếu phạm vi.
2. Trả `404` (không phải `403`) khi bản ghi tồn tại nhưng ngoài phạm vi — tránh lộ sự tồn tại.
3. Tên giáo viên/trợ giảng trong chấm công & điểm danh **luôn** lấy từ `schedules`, không nhận từ client.

## 4. Bản đồ module → bảng → route

| Module | Bảng chính | Route API | Màn hình web |
|---|---|---|---|
| Tài khoản | `users`, `user_schools`, `refresh_tokens`, `password_resets` | `/api/auth`, `/api/users` | `features/auth`, `features/admin/users` |
| Tổ chức | `schools`, `classes`, `class_assignments`, `stem_rooms` | `/api/schools`, `/api/classes`, `/api/rooms` | `features/admin/schools` |
| Lịch dạy | `schedules` | `/api/schedules` | `features/schedule` |
| Chấm công | `timesheets` | `/api/timesheets` | `features/timesheet` |
| Điểm danh | `attendance` | `/api/attendance` | `features/attendance` |
| Thiết bị | `device_catalog`, `device_checks`, `device_issues` | `/api/devices` | `features/devices` |
| Học liệu | `materials`, `material_versions`, `material_comments` | `/api/materials` | `features/materials` |
| Giải pháp | `solutions`, `solution_items` | `/api/solutions` | `features/solutions` |
| Góp ý | `feedback`, `feedback_replies` | `/api/feedback` | `features/feedback` |
| Thông báo | `notifications` | `/api/notifications` | `components/NotificationBell` |
| Báo cáo | (tổng hợp) | `/api/reports` | `features/reports` |
| Nhật ký | `audit_log` | `/api/audit` | `features/admin/audit` |
| Tệp | `files` | `/api/files` | dùng chung |

## 5. Luồng nghiệp vụ then chốt

### 5.1 Chấm công (`timesheets`)
1. GV mở buổi dạy hôm nay (từ `schedules`).
2. **Check-in**: bắt buộc GPS + ảnh thiết bị đầu buổi + số lượng thiết bị đếm tay.
   - Server tính `distance_m` = haversine(toạ độ gửi lên, toạ độ trường).
   - `distance_m > schools.gps_radius_m` ⇒ bắt buộc `check_in_note`, đặt `gps_flagged = true`,
     `approval_status = 'pending'` để Phòng chuyên môn duyệt tay.
   - Nhãn giờ tính bằng **giờ server**: `late_minutes = check_in_at - (date + start_time)`;
     `<= grace_minutes` ⇒ `ontime`, ngược lại `late`. Không check-in ⇒ `absent` (job cuối ngày).
3. **Check-out**: thời gian thực + tình trạng thiết bị. Nếu `has_damage` ⇒ bắt buộc mô tả + ảnh
   ⇒ server tự tạo bản ghi `device_issues` với `status='new'` và bắn thông báo cho `manager`.

### 5.2 Điểm danh (`attendance`)
- Trường/lớp/người dạy tự điền từ `schedules` (client chỉ gửi `schedule_id`).
- Bắt buộc `present_count` + tối thiểu 1 ảnh tổng quan lớp.
- `roster_size` snapshot từ `classes.roster_size` tại thời điểm điểm danh.
- Dashboard Phòng chuyên môn hiển thị buổi `Chưa điểm danh` để nhắc.

### 5.3 Thiết bị (`device_checks`)
- 4 mốc/ngày: `morning_start`, `morning_end`, `afternoon_start`, `afternoon_end`
  (bật/tắt từng mốc theo trường qua `schools.device_slots`).
- Mỗi lượt: ảnh + `items` (jsonb `[{catalog_id, qty, note}]`) + ghi chú.
- Chênh lệch so với `device_catalog.expected_qty` ⇒ gợi ý tạo `device_issues`.

### 5.4 Học liệu (`materials`)
- 3 cấp × 2 khu vực: `level ∈ {primary, secondary, highschool}`, `area ∈ {official, teacher}`.
- `official`: chỉ `admin`/`manager` tải lên; GV/TG xem + tải về, nhận thông báo khi có bản mới.
- `teacher`: GV/TG tải slide của mình lên; `manager` xem, bình luận, duyệt (`approval_status`).
- Mỗi lần tải lên tạo một `material_versions` mới — giữ nguyên lịch sử phiên bản.

## 6. Chế độ offline (`web/src/lib/offline.js`)
Chỉ bật cho hai thao tác hiện trường: **chấm công** và **điểm danh**.

1. Thao tác được ghi vào IndexedDB store `outbox` (`{id, endpoint, method, body, files[], createdAt}`),
   ảnh giữ dạng Blob.
2. UI hiển thị ngay ở trạng thái `⏳ chờ đồng bộ`.
3. Khi `navigator.onLine` hoặc mỗi 30s, worker gửi tuần tự theo `createdAt`.
4. Thời gian nghiệp vụ dùng **giờ server lúc nhận**, nhưng gửi kèm `client_time` + `queued_at`
   để đối chiếu; bản ghi đồng bộ trễ được đánh dấu `synced_late = true` cho kế toán biết.
5. Không bao giờ xoá bản ghi cục bộ dựa trên phản hồi máy chủ — chỉ đánh dấu đã gửi.

## 7. Quy ước mã nguồn
- **JavaScript thuần** (ESM), không TypeScript — khớp thói quen bảo trì hiện tại của đội.
- Toàn bộ chuỗi hiển thị bằng **tiếng Việt có dấu**.
- Backend: Fastify + `pg` (không ORM), SQL viết tay trong `server/src/routes/*`.
- Frontend: React 18 + React Router + Tailwind, state bằng React Query-lite tự viết (`lib/api.js`).
- Tên biến/hàm tiếng Anh, comment tiếng Việt.
- Màu thương hiệu: tím `#8a3f97` (chủ đạo), gradient `#ee6c98 → #a94f9f → #6f3fa2`.

## 8. Bảo mật
- Mật khẩu băm `bcrypt` cost 12. Không có đăng ký công khai — chỉ `admin` tạo tài khoản.
- Access token JWT 15 phút; refresh token 30 ngày lưu bảng `refresh_tokens` (băm SHA-256, thu hồi được).
- `must_change_password = true` khi tài khoản mới ⇒ mọi route trừ `/api/auth/change-password` trả `428`.
- Rate limit: `/api/auth/login` 10 lần / 15 phút / IP.
- Mọi thao tác ghi lên dữ liệu chấm công/lương ghi `audit_log`.
- Ảnh phục vụ qua route có kiểm quyền, không để nginx serve trực tiếp thư mục uploads.

## 9. Điểm cần Ban lãnh đạo xác nhận (Mục 17 bản yêu cầu)
- [ ] Vai trò thứ 4 là `assistant` (Trợ giảng) với quyền như Mục 2 — mặc định đã cài đặt như trên.
- [ ] Số trường/lớp dự kiến (ảnh hưởng chỉ mục & phân trang; hiện thiết kế cho ~200 trường, ~5.000 lớp).
- [ ] Bán kính GPS mặc định — **hiện đặt 150m**, sửa được từng trường ở màn hình Trường.
- [ ] Ngưỡng trễ (`grace_minutes`) — **hiện đặt 10 phút**, sửa được từng trường.
- [ ] Số Admin song song & ai duyệt Admin đầu tiên — hiện seed 1 Admin từ biến môi trường.
- [ ] Tích hợp phần mềm lương hay chỉ xuất Excel — **hiện chỉ xuất Excel** (`/api/reports/payroll.xlsx`).
