# Hướng dẫn triển khai LtL TeachOps lên VPS

Dành cho VPS đã cài sẵn **aaPanel** (hoặc bt-panel). Tổng thời gian khoảng 20 phút.

**Kiến trúc sau khi xong:**

```
Điện thoại / máy tính giáo viên
        │
        ├─ https://teacher.learntoleap.vn ──► Vercel (giao diện React)
        │                                        │ gọi API
        └────────────────────────────────────────┘
                                                 ▼
                        https://teachops-api.learntoleap.vn
                                                 │
                                    VPS: Nginx (aaPanel) + SSL
                                                 │ chuyển tiếp
                                    http://127.0.0.1:3000
                                                 │
                              Docker: api (Fastify) ──► db (PostgreSQL)
                                                 │
                                    /opt/ltl-teachops/data/uploads (ảnh)
```

> Nginx và SSL do aaPanel lo, nên **không cần** container Caddy. Cổng 3000 chỉ mở
> trên `127.0.0.1` — Internet không truy cập thẳng vào được, mọi kết nối phải qua Nginx.

---

## Bước 0 — Trỏ tên miền về VPS (làm trước, DNS cần thời gian lan truyền)

Vào nơi quản lý DNS của `learntoleap.vn`, thêm một bản ghi:

| Loại | Tên (Host) | Giá trị | TTL |
|---|---|---|---|
| `A` | `teachops-api` | `14.225.206.251` | Auto / 300 |

Kiểm tra đã trỏ đúng chưa (chạy ở Terminal của aaPanel):

```bash
ping -c 2 teachops-api.learntoleap.vn
```

Thấy IP `14.225.206.251` là được. Chưa thấy thì chờ 5–15 phút rồi thử lại.

## Bước 1 — Cài Docker (bỏ qua nếu đã có)

Trong aaPanel, sidebar trái có mục **Docker** — bấm vào, nếu hiện nút *Install* thì
bấm và chờ. Hoặc chạy ở **Terminal**:

```bash
command -v docker && docker compose version || curl -fsSL https://get.docker.com | sh
```

## Bước 2 — Tải mã nguồn về VPS

Mở **Terminal** trong aaPanel, chạy:

```bash
mkdir -p /opt && cd /opt && git clone https://github.com/LearntoLeap/ltl-teachops.git && cd ltl-teachops
```

Repo đang để **Private** thì Git sẽ hỏi tài khoản. Cách gọn nhất là tạo
**Personal Access Token** (GitHub → Settings → Developer settings → Personal access
tokens → Tokens (classic) → Generate, tích quyền `repo`), rồi clone bằng:

```bash
cd /opt && git clone https://<TOKEN>@github.com/LearntoLeap/ltl-teachops.git && cd ltl-teachops
```

## Bước 3 — Chạy script cài đặt

```bash
cd /opt/ltl-teachops && bash infra/setup-vps.sh
```

Script tự làm: sinh mật khẩu ngẫu nhiên → tạo `.env` → build → khởi động → kiểm tra.
Lần đầu mất 2–4 phút vì phải tải image và build.

Xong, màn hình in ra **email + mật khẩu Quản trị viên** — chép lại ngay.

> Chạy lại script nhiều lần vẫn an toàn: `.env` đã có thì giữ nguyên, dữ liệu
> trong `data/` không bị đụng tới.

## Bước 4 — Tạo Proxy Project trong aaPanel

Vào **Website** → tab **Proxy Project** → **Add site**:

| Ô | Điền |
|---|---|
| Domain name | `teachops-api.learntoleap.vn` |
| Target URL / Proxy | `http://127.0.0.1:3000` |
| Send domain | `$host` (để mặc định nếu có) |
| Apply for SSL | ✅ tích |

Bấm **Confirm**. aaPanel tự xin chứng chỉ Let's Encrypt.

Kiểm tra:

```bash
curl https://teachops-api.learntoleap.vn/api/health
```

Phải nhận được: `{"ok":true,"service":"teachops-api","time":"..."}`

### Chỉnh thêm cho API (quan trọng)

API có tải ảnh lên (tối đa 15MB) và có luồng thông báo thời gian thực (SSE).
Nginx mặc định sẽ chặn/đệm hai thứ này. Vào **Website** → site vừa tạo →
**Conf** (hoặc **Config File**), thêm vào trong khối `server { ... }`:

```nginx
# Ảnh minh chứng tối đa 15MB — nới giới hạn mặc định 1MB của Nginx
client_max_body_size 20m;

# Thông báo thời gian thực (SSE): tắt đệm để tin nhắn tới ngay
location /api/notifications/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
    proxy_set_header Host $host;
}
```

Lưu lại, aaPanel tự nạp lại Nginx.

## Bước 5 — Nối giao diện Vercel với API

1. Vào project `ltl-teachops` trên Vercel → **Settings** → **Environment Variables**
2. Thêm biến:

   | Key | Value | Environment |
   |---|---|---|
   | `VITE_API_URL` | `https://teachops-api.learntoleap.vn` | Production, Preview, Development |

3. Sang tab **Deployments** → bản mới nhất → dấu `...` → **Redeploy**
   (nhớ **bỏ tích** "Use existing Build Cache")

Xong. Mở `https://teacher.learntoleap.vn`, hộp cảnh báo vàng biến mất và bạn
đăng nhập được bằng tài khoản Quản trị viên ở Bước 3.

---

## Vận hành hằng ngày

| Việc | Lệnh (chạy trong `/opt/ltl-teachops`) |
|---|---|
| Cập nhật code mới từ GitHub | `bash infra/deploy.sh` |
| Xem log API | `docker compose logs -f api` |
| Xem trạng thái | `docker compose ps` |
| Khởi động lại API | `docker compose restart api` |
| Sao lưu CSDL | `bash infra/backup.sh` |
| Đổi cấu hình (CORS, email…) | sửa `.env` rồi `docker compose up -d --force-recreate api` |

**Nên đặt lịch sao lưu tự động**: aaPanel → **Cron** → Add task, loại *Shell Script*,
chạy hằng ngày lúc 2:00 sáng, nội dung:

```bash
cd /opt/ltl-teachops && bash infra/backup.sh
```

## Xử lý sự cố

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| `curl .../api/health` không phản hồi | API chưa chạy. Xem `docker compose logs --tail 60 api` |
| Trang web báo lỗi CORS | `CORS_ORIGINS` trong `.env` thiếu tên miền web. Thêm vào rồi `docker compose up -d --force-recreate api` |
| Tải ảnh báo lỗi 413 | Thiếu `client_max_body_size 20m;` trong cấu hình Nginx (Bước 4) |
| Chuông thông báo không tự cập nhật | Thiếu khối `location /api/notifications/stream` (Bước 4) |
| aaPanel xin SSL thất bại | DNS chưa trỏ đúng về IP VPS, hoặc cổng 80 đang bị chặn. Kiểm tra Bước 0 |
| Quên mật khẩu Admin | `grep SEED_ADMIN /opt/ltl-teachops/.env` — chỉ dùng được nếu chưa từng đổi mật khẩu; đã đổi rồi thì dùng chức năng Quên mật khẩu |
| Hết dung lượng đĩa | Dọn image cũ: `docker image prune -af` |

## Bảo mật

- `.env` chứa mật khẩu CSDL và `JWT_SECRET` — đặt quyền `600`, đã bị `.gitignore` chặn.
- Postgres **không mở cổng ra ngoài**, chỉ container `api` gọi được.
- Cổng 3000 chỉ lắng nghe trên `127.0.0.1`, bắt buộc đi qua Nginx + SSL.
- Ảnh minh chứng phục vụ qua route có kiểm tra quyền, không để Nginx đọc thẳng thư mục.
