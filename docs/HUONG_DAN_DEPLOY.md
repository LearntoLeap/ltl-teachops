# Hướng dẫn triển khai LtL TeachOps

Hệ thống gồm 2 nửa, triển khai độc lập:

| Thành phần | Chạy ở đâu | Deploy thế nào |
|---|---|---|
| **API + PostgreSQL + ảnh** | VPS (≥ 2GB RAM, khuyến nghị 4GB) | Docker Compose, hướng dẫn dưới |
| **Giao diện web (PWA)** | Vercel | Tự động khi push GitHub |

Cần chuẩn bị trước:
- 1 VPS Ubuntu 22.04/24.04, có IP public, mở cổng 22/80/443.
- 1 tên miền con trỏ về VPS, ví dụ `api.teachops.learntoleap.vn` (bản ghi DNS **A** → IP VPS).
- Tài khoản GitHub (repo private `ltl-teachops`) và tài khoản Vercel.

---

## PHẦN A — VPS (API + cơ sở dữ liệu)

### A1. Cài Docker (một lần)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Đăng xuất SSH rồi vào lại để nhóm docker có hiệu lực.
docker --version && docker compose version
```

### A2. Lấy mã nguồn

```bash
sudo mkdir -p /opt/ltl-teachops && sudo chown $USER /opt/ltl-teachops
cd /opt/ltl-teachops
git clone git@github.com:<TAI_KHOAN>/ltl-teachops.git .
```

> Repo private: tạo **Deploy key** — `ssh-keygen -t ed25519 -f ~/.ssh/teachops_deploy` trên VPS,
> dán public key vào GitHub → repo → Settings → Deploy keys (chỉ cần Read).

### A3. Cấu hình biến môi trường

```bash
cp .env.example .env
nano .env
```

Bắt buộc sửa các dòng sau:

| Biến | Ghi chú |
|---|---|
| `POSTGRES_PASSWORD` | Sinh bằng `openssl rand -base64 32` |
| `JWT_SECRET` | Sinh bằng `openssl rand -base64 48` |
| `CORS_ORIGINS` | Tên miền web thật, ví dụ `https://ltl-teachops.vercel.app` (thêm domain riêng nếu có, phân tách phẩy) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Tài khoản Admin đầu tiên — **bắt buộc đổi mật khẩu ở lần đăng nhập đầu** |
| `API_DOMAIN` | `api.teachops.learntoleap.vn` (đúng tên miền đã trỏ DNS) |
| `ACME_EMAIL` | Email nhận thông báo chứng chỉ TLS |
| `APP_PUBLIC_URL` | Địa chỉ web, dùng trong email gửi người dùng |
| `SMTP_*` | Bỏ trống được — khi đó mật khẩu tạm hiện trên màn hình Admin thay vì gửi email |

### A4. Khởi động

```bash
docker compose up -d
docker compose logs -f api      # chờ thấy "[boot] API đang lắng nghe tại cổng 3000"
```

Lần đầu khởi động, Postgres tự chạy `server/db/migrations/001_init.sql` (tạo bảng)
và API tự tạo tài khoản Admin từ `SEED_ADMIN_*`.

Kiểm tra từ máy bất kỳ:

```bash
curl https://api.teachops.learntoleap.vn/api/health
```

Trả `{"ok":true,...}` là xong phần VPS. Nếu lỗi TLS: kiểm tra DNS đã trỏ đúng chưa
(`dig +short api.teachops.learntoleap.vn`) rồi `docker compose restart caddy`.

### A5. Cập nhật phiên bản mới về sau

```bash
cd /opt/ltl-teachops && bash infra/deploy.sh
```

Script tự: kéo code → build lại API → khởi động lại → chạy migration mới → kiểm tra sức khoẻ.
Postgres/Caddy không bị động chạm.

### A6. Sao lưu hằng đêm (rất nên bật)

```bash
crontab -e
# thêm dòng:
30 2 * * * cd /opt/ltl-teachops && bash infra/backup.sh >> backups/backup.log 2>&1
```

Sao lưu CSDL + toàn bộ ảnh vào `backups/`, giữ 14 bản gần nhất. Lệnh khôi phục in sẵn ở cuối mỗi lần chạy.

---

## PHẦN B — Vercel (giao diện web)

### B1. Đẩy code lên GitHub (làm ở máy cá nhân)

```bash
cd C:\Users\admin\ltl-teachops
git remote add origin git@github.com:<TAI_KHOAN>/ltl-teachops.git
git push -u origin main
```

### B2. Tạo project Vercel

1. vercel.com → **Add New → Project** → chọn repo `ltl-teachops`.
2. **Root Directory**: chọn `web` (quan trọng — repo chứa cả server).
3. Framework: Vite (tự nhận). Build command `npm run build`, output `dist` (mặc định).
4. **Environment Variables** thêm:
   - `VITE_API_URL` = `https://api.teachops.learntoleap.vn`
5. Deploy. Xong sẽ có địa chỉ `https://ltl-teachops.vercel.app`.

### B3. Nối hai đầu

Quay lại VPS, đảm bảo `.env` có đúng domain web trong `CORS_ORIGINS`
(và `APP_PUBLIC_URL`), rồi:

```bash
docker compose up -d api
```

Từ đó về sau: **push GitHub = web tự deploy**; API cập nhật bằng `bash infra/deploy.sh`.

---

## PHẦN C — Kiểm tra đầu-cuối sau khi triển khai

1. Mở địa chỉ web → màn đăng nhập hiện logo LtL nền tím.
2. Đăng nhập bằng `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` → hệ thống **bắt buộc đổi mật khẩu**.
3. Vào **Trường & Lớp** → tạo trường đầu tiên (điền toạ độ GPS: mở Google Maps,
   bấm giữ vị trí cổng trường, sao chép 2 số toạ độ).
4. Tạo lớp + phòng STEM + danh mục thiết bị cho trường.
5. Vào **Tài khoản** → tạo 1 Giáo viên thử → nhận mật khẩu tạm (trên màn hình nếu chưa cấu hình SMTP).
6. Vào **Lịch dạy** → phân công giáo viên đó 1 buổi hôm nay.
7. Mở điện thoại, đăng nhập giáo viên → đổi mật khẩu → Trang chủ hiện buổi dạy →
   **Check-in** (cấp quyền Vị trí + chụp ảnh) → **Điểm danh** (chụp ảnh lớp) → **Check-out**.
8. Quay lại tài khoản quản lý → **Báo cáo** → xuất thử `Bảng chấm công.xlsx`.

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| Web báo "Không kết nối được máy chủ" | `VITE_API_URL` sai, hoặc API chưa chạy (`docker compose ps`), hoặc thiếu domain trong `CORS_ORIGINS` |
| Đăng nhập báo lỗi CORS trong Console | Thêm chính xác origin của web (kể cả `https://`) vào `CORS_ORIGINS`, restart api |
| TLS không cấp được | DNS chưa trỏ đúng IP, hoặc cổng 80/443 bị firewall chặn (`ufw allow 80,443/tcp`) |
| Check-in báo "ngoài bán kính" dù đứng trong trường | Trường chưa nhập đúng toạ độ, hoặc bán kính nhỏ — sửa ở Trường & Lớp → Thông tin (`gps_radius_m`) |
| Email không gửi | Chưa khai `SMTP_*`; hệ thống vẫn chạy, mật khẩu tạm hiện trên màn hình Admin |
| VPS đầy ổ | Ảnh nằm ở `data/uploads`, backup ở `backups/` — gắn thêm volume hoặc giảm số bản backup giữ lại |
