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
| Trợ giảng | `assistant` | Như giáo viên, quyền hẹp hơn |

Không có đăng ký công khai — mọi tài khoản do Admin tạo, bắt buộc đổi mật khẩu lần đầu.

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

## Điểm chờ Ban lãnh đạo xác nhận

Xem mục 9 trong `docs/ARCHITECTURE.md` — vai trò Trợ giảng, bán kính GPS mặc định (150m),
ngưỡng trễ (10 phút), số Admin, tích hợp lương. Tất cả đều sửa được qua cấu hình, không cần sửa code.
