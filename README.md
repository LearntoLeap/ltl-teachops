# LtL TeachOps

Hệ thống quản lý vận hành giáo viên & trợ giảng — **Công ty CP Công nghệ Giáo dục Learn to Leap**.

Chấm công GPS · Điểm danh học sinh · Kiểm kê thiết bị phòng STEM · Học liệu · Danh mục giải pháp ·
Góp ý · Báo cáo & xuất Excel · Phân quyền 4 vai trò · PWA hoạt động offline cho hiện trường.

## Kiến trúc

```
web/     React 18 + Vite + Tailwind (PWA)  → deploy Vercel
server/  Fastify + PostgreSQL 16           → deploy VPS bằng Docker Compose
infra/   Caddyfile (TLS tự động) + script deploy/backup
docs/    ARCHITECTURE.md · API.md · HUONG_DAN_DEPLOY.md
```

| Vai trò | Mã | Phạm vi |
|---|---|---|
| Quản trị viên | `admin` | Toàn hệ thống, tạo tài khoản |
| Phòng chuyên môn | `manager` | Các trường được gán |
| Giáo viên | `teacher` | Lớp/buổi được phân công |
| Trợ giảng | `assistant` | **Quyền ngang Giáo viên** — hỗ trợ giáo viên tại lớp |

Không có đăng ký công khai — mọi tài khoản do Admin tạo, bắt buộc đổi mật khẩu lần đầu.

## Tính năng chính

**Vận hành hiện trường**
- Chấm công GPS: bắt buộc **ảnh selfie** + ảnh thiết bị + đếm thiết bị; ngoài bán kính phải ghi lý do
  và chờ duyệt. Các **tiết nối tiếp** trong cùng buổi sáng/chiều chỉ cần cập nhật thiết bị.
- Điểm danh: sĩ số dạng **X/Y**, nhập tên học sinh vắng thì tự trừ sĩ số, bắt buộc ảnh lớp.
- Kiểm kê thiết bị 4 mốc/ngày, mỗi loại kèm **tình trạng** (tốt / có hỏng / thiếu-mất); hỏng thì
  tự sinh phiếu báo cho Phòng chuyên môn.
- **Offline-first**: mất mạng vẫn chấm công/điểm danh được, tự đồng bộ khi có sóng.
- **Video minh chứng** (≤100MB) ở điểm danh, báo hỏng thiết bị, góp ý — quay thẳng từ điện thoại.
- **Kho ảnh/video trên Google Drive**: Admin kết nối ngay trong app; tệp tự xếp theo
  Trường › Tháng › Nghiệp vụ. Bản gốc ảnh/video hiện trường và **học liệu lớn (≥20MB)** tự dọn khỏi VPS
  sau khi Drive xác nhận md5 — app vẫn mở xem và tải ZIP bình thường (lấy lại từ Drive).

**Lịch dạy** — 3 cách xem: danh sách, **thời khoá biểu tuần** (bảng × khung giờ), **lịch tháng**.
Phòng chuyên môn/Admin xếp lịch lẻ hoặc lặp tuần; giáo viên tự thêm buổi bị thiếu (hệ thống ép
gắn đúng tên người tạo).

**Học liệu** — duyệt theo **Giải pháp** (UGOT, uKIT EDU, Stick'em…), trong mỗi giải pháp lọc tiếp
theo khối 1–12 và loại tài liệu (giáo án / giáo trình / slide / video / mục tự thêm). Có tiết –
tên bài – chương trình học, ảnh minh hoạ, phiên bản, bình luận, duyệt bài.
- **Đăng hàng loạt dạng bảng**: kéo-thả nhiều tệp, tự đoán tiết/khối/loại từ tên tệp, dán phân phối
  chương trình từ Excel; GV/TG chỉ nhận một thông báo tổng hợp cho cả lượt.
- **Tải về .zip theo lựa chọn**: tích chọn từng bài, theo bộ lọc, hoặc cả thư mục giải pháp; lọc riêng
  giáo án / slide…; xếp thư mục theo loại hoặc theo bài; kèm Excel danh mục.

**Quản trị** — tài khoản kèm **khu vực** & ngày sinh, danh mục thiết bị đề xuất (23 mục chuẩn),
tìm kiếm nhanh có gợi ý, thông báo realtime (SSE), nhật ký thao tác, xuất Excel 6 loại báo cáo.
**Nhập bảng Trường & Lớp** (dán từ Excel hoặc tệp mẫu), lớp gán sẵn GV/TG phụ trách.

## Chạy phát triển tại máy

Yêu cầu: Node ≥ 20, Docker (cho Postgres).

```bash
# 1. CSDL
docker run -d --name teachops-db -p 5432:5432 \
  -e POSTGRES_DB=teachops -e POSTGRES_USER=teachops -e POSTGRES_PASSWORD=dev \
  -v %cd%/server/db/migrations:/docker-entrypoint-initdb.d:ro postgres:16-alpine

# 2. API  (cửa sổ terminal 1)
cd server && npm install
set DATABASE_URL=postgres://teachops:dev@localhost:5432/teachops
set JWT_SECRET=day_la_khoa_dev_dai_it_nhat_32_ky_tu_nhe
set SEED_ADMIN_EMAIL=admin@dev.local
set SEED_ADMIN_PASSWORD=Admin1234
set UPLOAD_DIR=./data-dev/uploads
npm run dev

# 3. Dữ liệu mẫu (tuỳ chọn — tạo 2 trường, lớp, lịch, tài khoản demo)
npm run seed:demo

# 4. Web  (cửa sổ terminal 2)
cd web && npm install
npm run dev          # http://localhost:5173 — VITE_API_URL mặc định http://localhost:3000
```

## Triển khai thật

Đọc [docs/HUONG_DAN_DEPLOY.md](docs/HUONG_DAN_DEPLOY.md) — gồm: chuẩn bị VPS, `.env`,
`docker compose up -d`, tạo project Vercel, kiểm tra đầu-cuối và xử lý sự cố.

Cập nhật API sau này: `bash infra/deploy.sh` trên VPS. Web tự deploy khi push GitHub.

## Tài liệu

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — kiến trúc, quy tắc phân quyền & phạm vi dữ liệu, luồng nghiệp vụ.
- [docs/API.md](docs/API.md) — hợp đồng API đầy đủ (nguồn sự thật khi sửa server lẫn web).
- [docs/HUONG_DAN_GITHUB.md](docs/HUONG_DAN_GITHUB.md) — đẩy code lên GitHub + nối Vercel.
- [docs/HUONG_DAN_GOOGLE_DRIVE.md](docs/HUONG_DAN_GOOGLE_DRIVE.md) — kết nối Google Drive làm kho ảnh/video.

## Cấu hình đã chốt

| Mục | Giá trị | Sửa ở đâu |
|---|---|---|
| Quyền Trợ giảng | Ngang Giáo viên | `server/src/lib/rbac.js` |
| Bán kính GPS chấm công | **1.000 m** | Màn hình Trường (từng trường) |
| Ngưỡng tính trễ | **10 phút** | Màn hình Trường (từng trường) |
| Khung giờ nhắc check-out | 45 phút | Màn hình Trường — **chỉ Admin** |

Còn chờ xác nhận: quy mô trường/lớp dự kiến, có tích hợp phần mềm lương hay chỉ xuất Excel,
và danh sách cấp học ngoài K-12 (nếu cần). Chi tiết ở mục 9 `docs/ARCHITECTURE.md`.

## Lộ trình còn lại

- [x] Google Drive làm kho ảnh/video (kết nối trong app, tự dọn bản gốc VPS) — xem
      [docs/HUONG_DAN_GOOGLE_DRIVE.md](docs/HUONG_DAN_GOOGLE_DRIVE.md) (cần OAuth Client của bạn).
- [ ] Trợ giảng gửi ảnh vào nhóm Zalo/Telegram (cần tạo bot/OA và webhook).
