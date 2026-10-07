# STAGE 1: Build Image
FROM node:22-alpine AS builder

WORKDIR /app

# Cài đặt OpenSSL (cần cho Prisma trên Alpine)
RUN apk add --no-cache openssl libc6-compat

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Cài đặt toàn bộ dependencies (kể cả devDependencies để build)
RUN npm ci

# Copy toàn bộ mã nguồn và Prisma schema
COPY prisma ./prisma/
COPY src ./src/

# Sinh Prisma client
RUN npx prisma generate

# Build ứng dụng NestJS sang dist/
RUN npm run build

# Gỡ bỏ devDependencies để giảm kích thước
RUN npm prune --production

# ==========================================
# STAGE 2: Production Runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# Cài đặt OpenSSL cho Prisma client lúc runtime
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=8011

# Tạo non-root user để tăng tính bảo mật
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy node_modules, dist, prisma và uploads từ builder
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Tạo thư mục uploads và cấp quyền
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 8011

CMD ["node", "dist/src/main.js"]
