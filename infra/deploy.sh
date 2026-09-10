#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Cập nhật LtL TeachOps API trên VPS.
# Chạy tại thư mục dự án trên VPS:  bash infra/deploy.sh
# Làm gì: kéo code mới → build lại image api → khởi động lại → chạy migration →
#         kiểm tra sức khoẻ. Postgres và Caddy KHÔNG bị động chạm (không mất kết nối TLS).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [1/5] Kéo code mới nhất từ GitHub…"
git pull --ff-only

echo "==> [2/5] Build lại image API…"
docker compose build api

echo "==> [3/5] Khởi động lại API (db & caddy giữ nguyên)…"
docker compose up -d api

echo "==> [4/5] Chạy migration cơ sở dữ liệu (nếu có file mới)…"
docker compose exec -T api node src/scripts/migrate.js

echo "==> [5/5] Kiểm tra sức khoẻ…"
sleep 3
if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
  echo "✅ API hoạt động bình thường."
else
  echo "❌ API không phản hồi — xem log:  docker compose logs --tail 100 api"
  exit 1
fi

echo ""
echo "Hoàn tất. Frontend trên Vercel tự deploy khi push GitHub — không cần thao tác thêm."
