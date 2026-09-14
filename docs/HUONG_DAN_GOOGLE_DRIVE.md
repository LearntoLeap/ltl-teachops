# Hướng dẫn: Google Drive làm kho ảnh & video

Mọi ảnh/video giáo viên, trợ giảng gửi lên app (selfie chấm công, ảnh thiết bị, ảnh/video lớp học,
ảnh/video báo hỏng, góp ý) và tài liệu học liệu được **tự động đẩy lên Google Drive** của tài khoản
quản trị chính.

Sau khi tệp đã nằm an toàn trên Drive (kiểm tra khớp **md5** từng byte) và quá số ngày cài đặt
(mặc định **7 ngày**), **bản gốc ảnh/video trên VPS được xoá** để tiết kiệm dung lượng:

- App vẫn mở xem bình thường — máy chủ lấy tệp từ Drive rồi chuyển tiếp (có tua video).
- Ảnh thu nhỏ vẫn giữ trên VPS nên danh sách, lưới ảnh vẫn hiện nhanh.
- **Học liệu, ảnh bìa, ảnh đại diện luôn giữ trên VPS** (cần mở nhanh và tải ZIP).
- Tệp trên Drive bị xoá / đưa vào thùng rác trước khi dọn ⇒ app **không xoá** bản VPS mà tự đẩy lại.

**Cấu trúc trên Drive** — ứng dụng tự tạo, không cần làm tay:

```
LtL TeachOps — Ảnh & Video/                 ← app tự tạo trong "Drive của tôi"
├─ THCS Xuân Tâm/
│  └─ 2026-09/
│     ├─ Chấm công/     20260912-0805_6A1_Nguyễn Văn An_selfie.jpg
│     ├─ Điểm danh/     20260912-0850_6A1_Nguyễn Văn An_IMG_1234.mp4
│     ├─ Kiểm kê thiết bị/
│     ├─ Sự cố thiết bị/
│     └─ Góp ý/
└─ Dùng chung/          ← học liệu, góp ý không gắn trường
```

---

## Kết nối — làm ngay trong app (Admin, ~10 phút, một lần)

> **Không cần gửi mật khẩu Google cho ai.** Admin tự đăng nhập Google trên chính trang của Google;
> app chỉ nhận một "giấy phép" (refresh token) để tải tệp lên, lưu kín trên máy chủ.

Vào app bằng tài khoản **Quản trị viên** → menu **Quản trị → ☁️ Lưu trữ Drive**. Trang này hướng
dẫn 3 bước và hiện sẵn **Redirect URI** để chép.

### Bước 1 — Tạo OAuth client trên Google Cloud

Đăng nhập **tài khoản Google sẽ chứa ảnh** (Gmail hoặc Google Workspace của công ty), rồi:

1. Mở [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) →
   tạo project (vd **LtL TeachOps**) → bấm **Enable**.
2. Vào **OAuth consent screen** (Google Auth Platform):
   - **User type**: *Internal* nếu là tài khoản Google Workspace của công ty; *External* nếu là Gmail.
   - Điền tên ứng dụng + email hỗ trợ.
   - **Scopes / Data access** → thêm `https://www.googleapis.com/auth/drive.file`.
   - Với *External*: bấm **Publish app** (chuyển sang **In production**).
     ⚠️ Nếu để trạng thái *Testing*, Google **tự thu hồi quyền sau 7 ngày** và đồng bộ sẽ dừng.
     Phạm vi `drive.file` không cần Google thẩm định; khi đăng nhập có thể thấy cảnh báo
     "Google chưa xác minh ứng dụng" → bấm **Nâng cao → Tiếp tục** (vì chính bạn là chủ ứng dụng).
3. Vào [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials →
   OAuth client ID** → loại **Web application** → mục **Authorized redirect URIs** dán **đúng**
   địa chỉ hiện trên trang Lưu trữ Drive, trên máy chủ thật là:
   ```
   https://teachops-api.learntoleap.vn/api/drive/oauth/callback
   ```
4. Bấm **Create** → chép **Client ID** và **Client secret**.

### Bước 2 — Dán Client ID + Client secret vào app

Trên trang Lưu trữ Drive, dán hai giá trị → **Lưu**. Client secret chỉ lưu trên máy chủ và không
bao giờ hiển thị lại.

### Bước 3 — Bấm "Kết nối Google Drive"

App chuyển sang trang Google → đăng nhập **đúng tài khoản sẽ chứa ảnh** → **Cho phép** → tự quay
về app, hiện *"Đang đồng bộ với Google Drive"* kèm email tài khoản và nút **Mở thư mục trên Drive**.

Xong. Job nền đẩy tệp mỗi 5 phút; muốn đẩy ngay bấm **⟳ Đồng bộ ngay**. Lần đầu có thể mất vài
lượt để đẩy hết ảnh cũ.

---

## Vì sao lại cần các bước trên

- **OAuth thay vì Service Account**: Service Account không có dung lượng Drive riêng, tải tệp vào
  thư mục chia sẻ của Gmail thường sẽ lỗi `Service Accounts do not have storage quota`. OAuth giúp
  tệp nằm đúng trong "Drive của tôi" của tài khoản quản trị, tính vào dung lượng tài khoản đó.
- **Quyền `drive.file`**: ứng dụng **chỉ thấy các tệp/thư mục do chính nó tạo**, không đọc được
  bất cứ thứ gì khác trong Drive. Vì vậy thư mục gốc do app tự tạo (thư mục bạn tạo bằng tay thì
  app không ghi vào được). Bạn có thể **chia sẻ** thư mục `LtL TeachOps — Ảnh & Video` cho ban giám
  đốc như mọi thư mục khác, hoặc kéo nó vào vị trí khác trong Drive — app vẫn ghi tiếp bình thường.

---

## Cài đặt dung lượng (trang Lưu trữ Drive)

| Cài đặt | Mặc định | Ý nghĩa |
|---|---|---|
| Tự dọn bản gốc trên máy chủ | Bật | Tắt ⇒ VPS giữ mọi tệp, Drive chỉ là bản sao lưu |
| Giữ bản gốc trên máy chủ thêm (ngày) | 7 | Trong khoảng này ảnh mở nhanh nhất (lúc duyệt chấm công). 0 = dọn ngay khi đã lên Drive |
| Video minh chứng tối đa | 100 MB | Biến `MAX_VIDEO_MB` trong `.env` |
| Học liệu tối đa mỗi tệp | 300 MB | Biến `MAX_MATERIAL_MB`; Nginx phải cho phép lớn hơn (`client_max_body_size 310m`) |

Video được nhận ở: **Điểm danh** (ảnh/video lớp), **Báo hỏng thiết bị**, **Góp ý**, **Học liệu**.
Chấm công (selfie, ảnh thiết bị) và kiểm kê định kỳ vẫn **chỉ nhận ảnh**.

---

## Bảo vệ dữ liệu

- Khi đã có tệp **chỉ còn trên Drive**, app **không cho** đổi sang OAuth client khác hoặc kết nối
  bằng tài khoản Google khác — nếu đổi, app sẽ mất quyền đọc các tệp đó.
- **Ngắt kết nối** chỉ thu hồi quyền của app; tệp trên Drive vẫn còn nguyên. Trong thời gian ngắt,
  app không mở được các tệp đã chuyển cho tới khi **kết nối lại bằng đúng tài khoản cũ**.
- Không xoá hay đổi tên hàng loạt tệp trong thư mục trên Drive: app tham chiếu tệp theo mã, xoá tệp
  trên Drive sau khi VPS đã dọn là **mất tệp vĩnh viễn** (Drive giữ trong thùng rác 30 ngày).
- Mọi thao tác kết nối / đổi cài đặt / đồng bộ thủ công đều ghi vào **Nhật ký**.

---

## Theo dõi và xử lý sự cố

Trang Lưu trữ Drive hiển thị: đã lên Drive / đang chờ / đã giải phóng / máy chủ đang giữ, và lỗi gần nhất.

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Google báo `redirect_uri_mismatch` | Redirect URI ở Bước 1.3 không khớp | Chép lại đúng địa chỉ trên trang Lưu trữ Drive (có `https`, không có `/` ở cuối) |
| Đang chạy tốt, sau ~7 ngày báo `invalid_grant` | Ứng dụng OAuth còn ở chế độ *Testing* | Bước 1.2 → **Publish app**, rồi bấm **Kết nối lại** |
| Báo `invalid_grant` sau khi đổi mật khẩu Google | Google thu hồi quyền khi đổi mật khẩu | Bấm **Kết nối lại** (đúng tài khoản cũ) |
| "Tài khoản … khác tài khoản đang giữ ảnh/video" | Đăng nhập nhầm tài khoản ở Bước 3 | Kết nối lại bằng tài khoản ghi trong thông báo |
| Tải tệp báo lỗi 413 / "không gửi được tệp" | Nginx chặn tệp lớn | Thêm `client_max_body_size 310m;` vào cấu hình site API |
| Tệp "lỗi quá 5 lần" | Mạng/Drive lỗi kéo dài, hoặc tệp hỏng | Xem lỗi gần nhất; sửa xong chạy `docker compose exec api node src/scripts/drive-sync.js` |

Đẩy dồn + dọn thủ công bằng dòng lệnh (trên VPS):

```bash
docker compose exec api node src/scripts/drive-sync.js
```

---

## Cách cấu hình dự phòng bằng `.env` (không khuyên dùng)

Khi không muốn kết nối trong app, có thể lấy refresh token bằng script trên máy cá nhân
(`GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm run drive:auth`, redirect URI
`http://localhost:5899/oauth2callback`) rồi đặt `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REFRESH_TOKEN` trong `.env`. Cấu hình nhập trong app luôn được ưu tiên hơn `.env`.
