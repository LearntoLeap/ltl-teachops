# syntax=docker/dockerfile:1
FROM node:20-alpine

# CHỈ cài tzdata (1 gói nhỏ) để giờ Việt Nam đúng trong log và job nền.
#
# KHÔNG cài vips-dev: sharp >= 0.33 đã kèm sẵn bản libvips biên dịch cho Alpine
# (@img/sharp-linuxmusl-x64), npm tự tải khi cài. Gói vips-dev kéo theo hơn 200
# gói phụ thuộc, làm build lâu hàng chục phút trên đường truyền chậm — và hoàn
# toàn không cần thiết.
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime \
    && echo "Asia/Ho_Chi_Minh" > /etc/timezone

WORKDIR /app

# Cài phụ thuộc trước để tận dụng cache layer khi chỉ code thay đổi.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Kiểm tra sharp nạp được ngay lúc build — hỏng thì biết liền,
# thay vì tới lúc giáo viên tải ảnh mới phát hiện.
RUN node -e "const s=require('sharp'); console.log('sharp OK, libvips', s.versions.vips)"

COPY src ./src
COPY db ./db

# Thư mục tệp tải lên (được ánh xạ ra volume lúc chạy).
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads /app

USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
