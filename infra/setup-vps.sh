#!/usr/bin/env bash
# =============================================================================
# setup-vps.sh — Cài đặt LtL TeachOps API lần đầu trên VPS.
#
# Chạy:  bash infra/setup-vps.sh
#
# Làm gì:
#   1. Kiểm tra Docker
#   2. Tạo .env với mật khẩu ngẫu nhiên (KHÔNG ghi đè nếu .env đã có)
#   3. Build image API và khởi động db + api
#   4. Chờ API sẵn sàng rồi in thông tin đăng nhập
#
# An toàn: chạy lại nhiều lần vẫn được — .env đã có thì giữ nguyên, dữ liệu
# trong ./data không bị đụng tới.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

# Màu cho dễ đọc trên terminal
B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
step() { echo ""; echo "${B}==> $1${N}"; }
ok()   { echo "${G}✓${N} $1"; }
warn() { echo "${Y}!${N} $1"; }
die()  { echo "${R}✗ $1${N}" >&2; exit 1; }

# ---------------------------------------------------------------- 1. Docker
step "[1/4] Kiểm tra Docker"
command -v docker >/dev/null 2>&1 || die "Chưa có Docker. Cài trong aaPanel: Docker → Install, hoặc chạy: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "Docker có nhưng thiếu plugin compose. Cài: apt-get install -y docker-compose-plugin"
docker info >/dev/null 2>&1 || die "Docker chưa chạy. Khởi động: systemctl start docker"
ok "Docker $(docker --version | sed 's/Docker version //;s/,.*//') sẵn sàng"

# ------------------------------------------------- 1b. Chọn cổng còn trống
# VPS có thể đã chạy dịch vụ khác (site cũ, panel...). Dùng trùng cổng sẽ làm
# sập dịch vụ đó, nên tự dò cổng trống trong dải 3000-3020.
step "[1b/4] Tìm cổng trống cho API"
PICKED=""
for p in $(seq 3000 3020); do
  if ! ss -tln 2>/dev/null | grep -q ":${p} "; then PICKED="$p"; break; fi
done
[ -n "$PICKED" ] || die "Không tìm được cổng trống trong dải 3000-3020."
if [ "$PICKED" = "3000" ]; then
  ok "Cổng 3000 trống — dùng cổng này"
else
  warn "Cổng 3000 đã bị dịch vụ khác chiếm — API sẽ dùng cổng ${B}${PICKED}${N}"
fi
API_HOST_PORT_IN="${API_HOST_PORT:-$PICKED}"

# ---------------------------------------------------------------- 2. .env
step "[2/4] Chuẩn bị file cấu hình .env"

# Tham số truyền vào (có giá trị mặc định hợp lý)
API_DOMAIN_IN="${API_DOMAIN:-teachops-api.learntoleap.vn}"
WEB_URL_IN="${WEB_URL:-https://teacher.learntoleap.vn}"
ADMIN_EMAIL_IN="${ADMIN_EMAIL:-admin@learntoleap.vn}"

if [ -f .env ]; then
  warn ".env đã tồn tại — giữ nguyên, không ghi đè."
  warn "Muốn tạo lại: đổi tên file cũ (mv .env .env.cu) rồi chạy lại script này."
else
  # openssl có sẵn trên mọi VPS Linux; tr loại ký tự gây rắc rối cho shell/URL
  gen() { openssl rand -base64 "$1" | tr -d '\n=+/' | cut -c1-"$2"; }
  PG_PASS="$(gen 32 28)"
  JWT="$(gen 64 56)"
  ADMIN_PASS="LtL-$(gen 12 8)"

  cat > .env <<EOF
# Sinh tự động bởi infra/setup-vps.sh — $(date '+%d/%m/%Y %H:%M')
# GIỮ KÍN file này. Đã được .gitignore chặn, không bao giờ lên GitHub.

# ---- Cơ sở dữ liệu ----
POSTGRES_DB=teachops
POSTGRES_USER=teachops
POSTGRES_PASSWORD=${PG_PASS}

# ---- API ----
NODE_ENV=production
PORT=3000
# Cổng trên VPS mà Nginx sẽ trỏ vào (chỉ mở trên 127.0.0.1)
API_HOST_PORT=${API_HOST_PORT_IN}
JWT_SECRET=${JWT}
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

# Tên miền web được phép gọi API. Thêm tên miền mới thì ngăn cách bằng dấu phẩy
# rồi chạy: docker compose up -d --force-recreate api
CORS_ORIGINS=${WEB_URL_IN},https://ltl-teachops.vercel.app,http://localhost:5173

UPLOAD_DIR=/data/uploads
MAX_UPLOAD_MB=15

# ---- Tài khoản Admin đầu tiên ----
SEED_ADMIN_EMAIL=${ADMIN_EMAIL_IN}
SEED_ADMIN_PASSWORD=${ADMIN_PASS}
SEED_ADMIN_NAME=Quản trị hệ thống

# ---- Email: bỏ trống ⇒ mật khẩu tạm hiện trên màn hình Admin ----
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="LtL TeachOps <no-reply@learntoleap.vn>"
APP_PUBLIC_URL=${WEB_URL_IN}

# ---- Google Drive: bỏ trống ⇒ tắt đồng bộ (xem docs/HUONG_DAN_GOOGLE_DRIVE.md) ----
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
DRIVE_SYNC_MINUTES=5

# ---- Caddy: chỉ dùng khi chạy --profile caddy (aaPanel đã lo Nginx+SSL) ----
API_DOMAIN=${API_DOMAIN_IN}
ACME_EMAIL=it@learntoleap.vn
EOF
  chmod 600 .env
  ok "Đã tạo .env với mật khẩu ngẫu nhiên (quyền 600 — chỉ root đọc được)"
fi

# ---------------------------------------------------------------- 3. Khởi động
step "[3/4] Build và khởi động (lần đầu mất 2-4 phút)"
mkdir -p data/uploads data/pgdata
docker compose up -d --build
ok "Container đã khởi động"

# ---------------------------------------------------------------- 4. Kiểm tra
step "[4/4] Chờ API sẵn sàng"
# Đọc cổng thật từ .env (có thể .env đã tồn tại từ lần chạy trước)
PORT_OUT="$(grep -E '^API_HOST_PORT=' .env | cut -d= -f2- || true)"
PORT_OUT="${PORT_OUT:-3000}"
READY=0
for i in $(seq 1 40); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT_OUT}/api/health" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 3
  printf "."
done
echo ""

if [ "$READY" != "1" ]; then
  echo ""
  die "API không phản hồi sau 2 phút. Xem log để biết lý do:
    cd ${PROJECT_DIR} && docker compose logs --tail 60 api"
fi

ok "API phản hồi tốt tại http://127.0.0.1:${PORT_OUT}"

# In thông tin đăng nhập lấy từ .env (kể cả khi .env đã có sẵn từ trước)
ADMIN_EMAIL_OUT="$(grep -E '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2-)"
ADMIN_PASS_OUT="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2-)"
API_DOMAIN_OUT="$(grep -E '^API_DOMAIN=' .env | cut -d= -f2-)"

cat <<EOF

${G}${B}════════════════════════════════════════════════════════════${N}
${G}${B}  API ĐÃ CHẠY${N}
${G}${B}════════════════════════════════════════════════════════════${N}

${B}Tài khoản Quản trị viên đầu tiên:${N}
   Email     : ${ADMIN_EMAIL_OUT}
   Mật khẩu  : ${B}${ADMIN_PASS_OUT}${N}
   (hệ thống sẽ bắt đổi mật khẩu ngay lần đăng nhập đầu tiên)

${B}CÒN 2 BƯỚC NỮA:${N}

${B}1.${N} Trong aaPanel → Website → ${B}Proxy Project${N} → Add:
      Tên miền     : ${API_DOMAIN_OUT}
      Target URL   : http://127.0.0.1:${PORT_OUT}
      Tích ${B}Apply for SSL${N}
   (bản ghi DNS loại A của tên miền này phải trỏ về IP VPS trước)

${B}2.${N} Trên Vercel → Settings → Environment Variables, thêm:
      VITE_API_URL = https://${API_DOMAIN_OUT}
   rồi Redeploy.

${B}Lệnh hữu ích:${N}
   docker compose logs -f api      # xem log
   docker compose ps               # trạng thái container
   bash infra/deploy.sh            # cập nhật code mới từ GitHub

EOF
