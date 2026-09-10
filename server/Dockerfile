# syntax=docker/dockerfile:1
FROM node:20-alpine

# sharp cần thư viện ảnh gốc; tzdata để giờ Việt Nam đúng trong log.
RUN apk add --no-cache vips-dev tzdata \
    && cp /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime \
    && echo "Asia/Ho_Chi_Minh" > /etc/timezone

WORKDIR /app

# Cài phụ thuộc trước để tận dụng cache layer khi chỉ code thay đổi.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY db ./db

# Thư mục tệp tải lên (được ánh xạ ra volume lúc chạy).
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads /app

USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
