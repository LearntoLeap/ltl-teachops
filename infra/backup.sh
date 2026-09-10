#!/usr/bin/env bash
# =============================================================================
# backup.sh — Sao lưu cơ sở dữ liệu + thư mục ảnh về ./backups/.
# Nên đặt cron chạy hằng đêm trên VPS:
#   crontab -e
#   30 2 * * * cd /opt/ltl-teachops && bash infra/backup.sh >> backups/backup.log 2>&1
# Giữ 14 bản gần nhất, tự xoá bản cũ hơn.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p backups

STAMP="$(date +%Y%m%d-%H%M%S)"

# Đọc biến từ .env (POSTGRES_USER, POSTGRES_DB)
set -a; source .env; set +a

echo "==> Sao lưu CSDL → backups/db-${STAMP}.sql.gz"
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "backups/db-${STAMP}.sql.gz"

echo "==> Sao lưu ảnh/tệp → backups/uploads-${STAMP}.tar.gz"
tar -czf "backups/uploads-${STAMP}.tar.gz" -C data uploads

echo "==> Dọn bản cũ (giữ 14 bản mỗi loại)…"
ls -1t backups/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t backups/uploads-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "✅ Sao lưu xong: $(du -sh backups | cut -f1) tổng cộng."
echo ""
echo "KHÔI PHỤC (cẩn trọng — ghi đè dữ liệu hiện tại):"
echo "  gunzip -c backups/db-<STAMP>.sql.gz | docker compose exec -T db psql -U ${POSTGRES_USER} ${POSTGRES_DB}"
echo "  tar -xzf backups/uploads-<STAMP>.tar.gz -C data"
