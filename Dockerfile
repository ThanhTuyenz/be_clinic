# STAGE 1: Build Image
FROM node:22-alpine AS builder

WORKDIR /app

# OpenSSL phục vụ Prisma CLI/migration trên Alpine
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Prisma schema/config dùng cho generate khi build và migration khi deploy
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Cài đặt toàn bộ dependencies (kể cả devDependencies để build)
RUN npm ci

# Copy mã nguồn; npm run build đã bao gồm Prisma generate
COPY src ./src/

# Build ứng dụng NestJS sang dist/
RUN npm run build

# Gỡ bỏ devDependencies để giảm kích thước
RUN npm prune --omit=dev

# ==========================================
# STAGE 2: Production Runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# Workflow chạy Prisma migration trong container runtime
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=8011

# Tạo non-root user để tăng tính bảo mật
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy node_modules, dist, prisma và uploads từ builder
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
# Prisma 7 cần config này khi workflow chạy migrate deploy
COPY --from=builder --chown=nestjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Tạo thư mục uploads và cấp quyền
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 8011

CMD ["node", "dist/main.js"]
