# Hướng dẫn đẩy code lên GitHub

Toàn bộ code đã được commit sẵn ở máy. Việc còn lại: tạo repo trên GitHub và đẩy lên.
Làm một lần, các lần sau chỉ cần `git push`.

---

## Bước 1 — Tạo repo rỗng trên GitHub

1. Vào [github.com/new](https://github.com/new) (đăng nhập nếu chưa).
2. Điền:

   | Ô | Điền gì |
   |---|---|
   | **Repository name** | `ltl-teachops` |
   | **Description** | `Hệ thống quản lý vận hành giáo viên & trợ giảng — Learn to Leap` |
   | **Visibility** | **Private** ⚠️ |

3. **QUAN TRỌNG — để trống cả 3 ô này:**
   - ☐ Add a README file
   - ☐ Add .gitignore
   - ☐ Choose a license

   Repo dưới máy đã có sẵn README và .gitignore. Tích vào sẽ tạo commit trên GitHub
   khác với commit dưới máy, gây lỗi `rejected — fetch first` khi đẩy.

4. Bấm **Create repository**.

> **Vì sao phải Private:** repo chứa lược đồ dữ liệu chấm công, lương và thông tin trường học.
> Đây là dữ liệu nội bộ công ty.

## Bước 2 — Nối repo dưới máy với GitHub

Sau khi tạo, GitHub hiện trang hướng dẫn — **bỏ qua**, dùng lệnh dưới đây.
Thay `<tài-khoản>` bằng tên tài khoản GitHub của bạn:

```bash
cd C:\Users\admin\ltl-teachops && git remote add origin https://github.com/<tài-khoản>/ltl-teachops.git
```

Kiểm tra đã nối đúng chưa:

```bash
cd C:\Users\admin\ltl-teachops && git remote -v
```

Phải thấy hai dòng `origin  https://github.com/<tài-khoản>/ltl-teachops.git (fetch/push)`.

## Bước 3 — Đẩy code lên

```bash
cd C:\Users\admin\ltl-teachops && git push -u origin main
```

**Lần đầu sẽ hiện cửa sổ đăng nhập GitHub** → chọn **Sign in with your browser** → xác nhận
trên trình duyệt. Windows sẽ nhớ đăng nhập cho các lần sau.

Đẩy xong, mở `https://github.com/<tài-khoản>/ltl-teachops` — thấy đủ 108 file là thành công.

## Bước 4 — Kiểm tra CI tự chạy

Vào tab **Actions** trên repo. Có 2 việc tự chạy sau mỗi lần đẩy:

- **Kiểm tra API** — soát cú pháp toàn bộ mã server + build thử Docker image
- **Build giao diện** — build production bản web

Cả hai có dấu ✅ xanh là code lành lặn.

---

## Các lần sau

Mỗi khi sửa code:

```bash
cd C:\Users\admin\ltl-teachops && git add -A && git commit -m "Mô tả ngắn thay đổi" && git push
```

## Xử lý sự cố

| Lỗi | Nguyên nhân & cách sửa |
|---|---|
| `remote origin already exists` | Đã chạy lệnh Bước 2 trước đó. Sửa lại bằng: `git remote set-url origin https://github.com/<tài-khoản>/ltl-teachops.git` |
| `Updates were rejected... fetch first` | Lúc tạo repo có tích README/gitignore. Chạy: `git pull --rebase origin main` rồi `git push` lại. |
| `Repository not found` | Sai tên tài khoản trong URL, hoặc repo Private mà đăng nhập nhầm tài khoản. Kiểm tra `git remote -v`. |
| `Authentication failed` | Mật khẩu GitHub **không dùng** để đẩy code được nữa. Dùng **Sign in with your browser**, hoặc tạo Personal Access Token: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token, tích quyền `repo`, rồi dán token vào ô mật khẩu. |
| `src refspec main does not match any` | Chưa có commit nào hoặc nhánh tên khác. Kiểm tra: `git branch --show-current` (phải là `main`); nếu là `master` thì `git branch -M main`. |
| `filename too long` | Bật hỗ trợ đường dẫn dài: `git config --system core.longpaths true` (chạy PowerShell với quyền Administrator). |

---

## Những gì KHÔNG lên GitHub

`.gitignore` đã chặn sẵn — kiểm tra lại bất cứ lúc nào bằng `git status --ignored`:

| Bị chặn | Lý do |
|---|---|
| `.env`, `.env.local` | Chứa mật khẩu CSDL, JWT_SECRET, refresh token Google Drive |
| `data/` | Ảnh minh chứng và dữ liệu CSDL thật trên VPS |
| `node_modules/` | Tải lại được bằng `npm ci` |
| `web/dist/` | Vercel tự build |

Chỉ có `.env.example` được đẩy lên — file mẫu liệt kê tên biến, **mọi giá trị đều để trống**.

> Nếu lỡ commit nhầm file `.env` thật: đừng chỉ xoá file rồi commit tiếp — nội dung vẫn nằm
> trong lịch sử Git. Phải **đổi ngay toàn bộ mật khẩu/khoá** đã lộ, rồi xoá khỏi lịch sử
> bằng `git filter-repo` hoặc tạo lại repo.

## Bước tiếp theo: nối Vercel

Sau khi code đã lên GitHub:

1. Vào [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → chọn `ltl-teachops`.
2. **Root Directory**: bấm **Edit** → chọn **`web`** ⚠️ (bỏ qua bước này là build hỏng).
3. Framework Preset: Vercel tự nhận **Vite**.
4. **Environment Variables**: thêm `VITE_API_URL` = địa chỉ API trên VPS
   (ví dụ `https://api.teachops.ltl.edu.vn`). Chưa có VPS thì để tạm, sửa sau cũng được.
5. **Deploy**.

Từ đó mỗi lần `git push` là Vercel tự deploy lại bản web.
