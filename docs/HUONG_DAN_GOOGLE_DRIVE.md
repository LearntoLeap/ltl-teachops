# Hướng dẫn bật sao lưu ảnh lên Google Drive

Mọi ảnh minh chứng (selfie chấm công, ảnh thiết bị, ảnh lớp học, ảnh báo hỏng, ảnh góp ý)
và tài liệu học liệu sẽ được **tự động sao chép** lên Google Drive của tài khoản quản trị chính.

> **Ảnh vẫn lưu trên VPS.** Drive là **bản sao** để ban giám đốc xem/tải trực tiếp và lưu trữ
> dài hạn. Ứng dụng luôn đọc ảnh từ VPS cho nhanh — mất kết nối Drive không ảnh hưởng vận hành.

**Cấu trúc trên Drive** — tự tạo, không cần làm tay:

```
LtL TeachOps — Ảnh minh chứng/      ← thư mục bạn tạo, dán ID vào .env
├─ Tiểu học Xuân Hoà/
│  ├─ 2026-09/
│  │  ├─ 20260911-0805_selfie.jpg
│  │  └─ 20260911-0806_anh-thiet-bi.jpg
│  └─ 2026-10/
├─ THCS Xuân Tâm/
└─ Dùng chung/                      ← học liệu không gắn trường
```

---

## Vì sao dùng OAuth chứ không dùng Service Account

Cách phổ biến trên mạng là tạo *Service Account* rồi chia sẻ thư mục Drive cho nó. **Cách đó
KHÔNG chạy với tài khoản Gmail thường**: Service Account không có dung lượng Drive riêng, nên
Google trả lỗi `Service Accounts do not have storage quota` ngay khi tải tệp đầu tiên.

Hệ thống này dùng **OAuth refresh token**: bạn cho phép một lần, sau đó máy chủ tải tệp lên
**đúng danh nghĩa tài khoản quản trị** — tính vào dung lượng tài khoản đó và hiện ngay trong
"Drive của tôi". Cách này chạy với cả Gmail thường lẫn Google Workspace.

---

## Bước 1 — Tạo thư mục đích trên Drive

1. Mở [drive.google.com](https://drive.google.com) bằng **tài khoản quản trị chính**
   (tài khoản sẽ chứa toàn bộ ảnh).
2. Tạo thư mục mới, đặt tên: **LtL TeachOps — Ảnh minh chứng**
3. Mở thư mục đó. Nhìn thanh địa chỉ:

   ```
   https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv
                                          └────────── FOLDER_ID ──────────┘
   ```

4. Chép đoạn mã đó — đây là `GOOGLE_DRIVE_FOLDER_ID`.

## Bước 2 — Tạo OAuth Client trên Google Cloud

1. Vào [console.cloud.google.com](https://console.cloud.google.com), đăng nhập **cùng tài khoản** ở Bước 1.
2. Tạo project mới: bấm ô chọn project trên đầu → **New Project** → tên `LtL TeachOps` → **Create**.
3. **Bật Drive API**: menu trái → **APIs & Services** → **Library** → tìm `Google Drive API` → **Enable**.
4. **Khai báo màn hình xin quyền**: **APIs & Services** → **OAuth consent screen**
   - User Type: **External** → **Create**
   - App name: `LtL TeachOps`, User support email và Developer email: email của bạn → **Save and Continue**
   - Scopes: bỏ qua → **Save and Continue**
   - **Test users**: bấm **+ ADD USERS**, nhập **chính email quản trị của bạn** → **Save and Continue**

   > Bước Test users là **bắt buộc**. App đang ở chế độ "Testing", chỉ tài khoản trong danh sách
   > này mới cho phép được. Không cần xin Google duyệt (chỉ dùng nội bộ).

5. **Tạo Client ID**: **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `TeachOps Server`
   - **Authorized redirect URIs** → **+ ADD URI** → dán chính xác:

     ```
     http://localhost:5899/oauth2callback
     ```

   - **Create** → cửa sổ hiện **Client ID** và **Client secret** → chép cả hai.

## Bước 3 — Lấy refresh token (chạy trên máy tính cá nhân, một lần duy nhất)

Mở PowerShell tại thư mục dự án:

```bash
cd C:\Users\admin\ltl-teachops\server
```

Đặt hai biến vừa chép (thay bằng giá trị thật):

```bash
$env:GOOGLE_CLIENT_ID="123456789-abcxyz.apps.googleusercontent.com"
```

```bash
$env:GOOGLE_CLIENT_SECRET="GOCSPX-abcdefghijklmnop"
```

Chạy:

```bash
npm run drive:auth
```

Màn hình in ra một đường dẫn dài. **Mở đường dẫn đó trong trình duyệt**, đăng nhập bằng tài
khoản quản trị, bấm **Continue** (gặp cảnh báo "Google hasn't verified this app" thì bấm
**Advanced** → **Go to LtL TeachOps (unsafe)** — đây là app của chính bạn, an toàn).

Cho phép xong, cửa sổ dòng lệnh in ra 3 dòng — **chép lại**:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=1//0gAbCdEf...
```

## Bước 4 — Điền vào `.env` trên VPS

```bash
nano /opt/ltl-teachops/.env
```

Điền 5 dòng (4 dòng đầu từ Bước 2–3, dòng cuối từ Bước 1):

```ini
GOOGLE_CLIENT_ID=123456789-abcxyz.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnop
GOOGLE_DRIVE_REFRESH_TOKEN=1//0gAbCdEf...
GOOGLE_DRIVE_FOLDER_ID=1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv
DRIVE_SYNC_MINUTES=5
```

Khởi động lại API:

```bash
cd /opt/ltl-teachops && docker compose up -d --force-recreate api
```

Xem log để xác nhận:

```bash
docker compose logs -f api | grep drive
```

Thấy dòng này là xong:

```
[drive] Sẵn sàng — đồng bộ vào thư mục "LtL TeachOps — Ảnh minh chứng".
```

## Bước 5 — Đẩy dồn ảnh cũ (chỉ lần đầu)

Ảnh chụp trước khi bật Drive vẫn nằm trong hàng đợi. Đẩy hết ngay:

```bash
docker compose exec api node src/scripts/drive-sync.js
```

Từ đó về sau hệ thống tự đẩy mỗi 5 phút.

---

## Theo dõi và xử lý sự cố

**Xem tình trạng** — đăng nhập bằng tài khoản Quản trị viên rồi gọi:

```
GET /api/reports/drive
```

```json
{ "enabled": true, "total": 1250, "synced": 1248, "pending": 2, "failed": 0,
  "last_synced_at": "2026-09-11T08:15:00Z", "last_error": null }
```

**Đẩy ngay không chờ job**: `POST /api/reports/drive/sync` (chỉ Admin).

| Triệu chứng | Nguyên nhân & cách sửa |
|---|---|
| `[drive] Chưa cấu hình Google Drive` | Thiếu 1 trong 3 biến CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN trong `.env`. Kiểm tra rồi `docker compose up -d --force-recreate api`. |
| `Thiếu GOOGLE_DRIVE_FOLDER_ID` | Chưa dán ID thư mục ở Bước 1. |
| `invalid_grant` | Refresh token hết hiệu lực — xảy ra khi đổi mật khẩu Google, thu hồi quyền, hoặc app ở chế độ Testing **quá 7 ngày**. Chạy lại Bước 3 lấy token mới. **Muốn token không hết hạn: vào OAuth consent screen → PUBLISH APP** (chuyển từ Testing sang In production). |
| `không mở được thư mục gốc (404)` | FOLDER_ID sai, hoặc thư mục thuộc tài khoản khác với tài khoản đã cấp quyền. |
| `failed > 0` kéo dài | Xem `last_error` trong `/api/reports/drive`. Tệp lỗi quá 5 lần sẽ bị bỏ qua; sửa xong chạy `drive-sync.js` để thử lại. |
| Hết dung lượng Drive | Tài khoản Gmail miễn phí có 15GB dùng chung với Gmail/Photos. Ảnh đã nén còn ~150–400KB, ước tính ~3.000 ảnh/GB. Cần thêm thì nâng Google One hoặc dùng Workspace. |

## Bảo mật

- **Refresh token = chìa khoá ghi vào Drive của bạn.** Chỉ để trong `.env` trên VPS
  (đã bị `.gitignore` chặn), không gửi qua chat/email, không commit lên GitHub.
- Hệ thống chỉ xin quyền `drive.file` — **chỉ đụng được tệp do chính nó tạo**, không đọc
  được tệp sẵn có khác trong Drive của bạn.
- Muốn thu hồi bất cứ lúc nào: [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  → chọn **LtL TeachOps** → **Remove access**. Đồng bộ dừng ngay, app vẫn chạy bình thường.
