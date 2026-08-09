# PostgreSQL + Prisma runbook

Docker chưa được chạy trong đợt triển khai source này theo yêu cầu của chủ dự án.

## 1. Khởi động hạ tầng khi sẵn sàng

```powershell
docker compose -f docker-compose.infrastructure.yml up -d postgres rabbitmq redis
docker compose -f docker-compose.infrastructure.yml ps
```

PostgreSQL local: `localhost:5432`, RabbitMQ: `localhost:5672`, RabbitMQ UI: `http://localhost:15672`, Redis: `localhost:6379`.

## 2. Apply migration và seed

```powershell
npm run prisma:generate
npm run prisma:deploy
npm run seed:prisma
```

Tài khoản seed dùng chung mật khẩu `VitaCare@123`. Chỉ dùng cho local/dev.

## 3. Migrate Auth từ MongoDB

Backup MongoDB trước, kiểm tra `MONGO_URI`, `MONGO_DB_NAME` và `DATABASE_URL`, sau đó:

```powershell
npm run migrate:auth:mongo-to-prisma
```

Script giữ nguyên bcrypt hash, chỉ nhận 7 role chính thức và in báo cáo imported/updated/skipped/conflicted. Có thể chạy lại an toàn theo email.

## 4. Bật RabbitMQ expiration worker

Đổi trong `.env.development`:

```dotenv
RABBITMQ_ENABLED=true
REDIS_ENABLED=true
```

Khi RabbitMQ tắt, reconciliation timer vẫn quét các hold hết hạn mỗi phút. PostgreSQL luôn là source of truth.

## 5. Xác minh

```powershell
npm run prisma:validate
npm run build
```

Sau đó chạy backend và mở Swagger tại `http://localhost:8011/docs`.

Các test runtime bắt buộc trước cutover: concurrent last-slot checkout, expiration/payment race, duplicate webhook, duplicate RabbitMQ delivery, late success khi slot đầy, và concurrent check-in.

## 6. Lưu ý cutover

- Chưa gỡ MongoDB/TypeORM vì một số endpoint ngoài Auth và Booking core vẫn là legacy.
- Không chạy `prisma db push` trên môi trường dùng chung; dùng `prisma migrate deploy`.
- Chỉ bật traffic Booking mới sau khi concurrency test pass.
- Đặt `PAYMENT_WEBHOOK_SECRET` hoặc secret riêng theo provider trước khi nhận webhook thật.
