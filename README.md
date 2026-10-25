# VitaCare Clinic API (`be_clinic`)

Backend NestJS cho hệ thống phòng khám. PostgreSQL/Prisma phục vụ nghiệp vụ mới; Redis dùng cho cache; RabbitMQ dùng cho hàng đợi; MongoDB vẫn được một số module legacy sử dụng trong thời gian migrate.

## Yêu cầu

- Node.js 22+
- npm 10+
- Docker Desktop
- MongoDB local hoặc MongoDB URI có thể kết nối

| Dịch vụ | Cổng mặc định |
| --- | ---: |
| NestJS API | `8011` |
| PostgreSQL | `5432` |
| Redis | `6379` |
| RabbitMQ | `5672` |
| RabbitMQ Management | `15672` |
| MongoDB legacy | `27017` |

## Chạy dự án lần đầu — thực hiện đúng thứ tự

Chạy các lệnh trong PowerShell tại thư mục `be_clinic`.

### 1. Cài dependency

```powershell
npm install
```

### 2. Tạo file môi trường

```powershell
Copy-Item .env.example .env.development
```

Cập nhật tối thiểu:

```dotenv
NODE_ENV=development
PORT=8011
MONGODB_URI=mongodb://127.0.0.1:27017/clinic
JWT_SECRET=replace-with-a-long-random-secret

DATABASE_URL=postgresql://vitacare:vitacare_local@localhost:5432/vitacare?schema=public
DIRECT_URL=postgresql://vitacare:vitacare_local@localhost:5432/vitacare?schema=public
REDIS_URL=redis://:vitacare_local@localhost:6379
RABBITMQ_URL=amqp://vitacare:vitacare_local@localhost:5672
```

Không commit `.env.development`. Repository ignore toàn bộ `.env*`, ngoại trừ `.env.example`.

Nếu dùng PayOS (VietQR), điền các biến `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. Webhook URL trỏ tới `/api/v1/payments/webhook`.

### 3. Khởi động Docker

Mở Docker Desktop, sau đó chạy:

```powershell
docker compose up -d postgres redis rabbitmq
docker compose ps
```

Chờ ba container chuyển sang `healthy` trước khi chạy Prisma hoặc backend.

```powershell
docker compose logs -f postgres redis rabbitmq
```

> Docker Compose hiện quản lý PostgreSQL, Redis và RabbitMQ. MongoDB local vẫn phải chạy hoặc `MONGODB_URI` phải trỏ tới MongoDB bên ngoài.

### 4. Kiểm tra schema và generate Prisma Client

```powershell
npm run prisma:validate
npm run prisma:generate
```

`prisma:generate` chỉ tạo Prisma Client, không tạo bảng PostgreSQL.

### 5. Apply migration PostgreSQL

Với source đã có migration:

```powershell
npm run prisma:deploy
```

Khi tự sửa Prisma schema và cần tạo migration development mới:

```powershell
npm run prisma:migrate -- --name ten_migration
```

Không dùng `prisma db push` cho database dùng chung hoặc production.

### 6. Seed dữ liệu development

Với database trống, apply migration rồi nạp bộ dữ liệu mẫu:

```powershell
npm run prisma:deploy
npm run prisma:seed
```

Lịch sử migration đã gộp thành `20261025000000_init/migration.sql`, sinh từ schema
hiện tại và giữ các CHECK constraint cho lịch tiếp nhận. Chỉ áp dụng initial migration
này cho database mới, hoàn toàn trống; không dùng trực tiếp cho database đã có bảng
hoặc lịch sử migration cũ. Các migration trước vẫn có thể xem lại trong lịch sử Git.

Seed đã đồng bộ metadata gói dịch vụ, liên kết phương thức đặt khám, lịch tiếp nhận,
phí và cờ tư vấn online. Chạy seed bình thường sẽ dừng nếu database đã có dữ liệu.
Nếu chủ động muốn XÓA toàn bộ dữ liệu hiện tại và nạp lại bộ demo:

```powershell
npm run prisma:seed -- --reset
```

Seed dùng `.env.development` mặc định. Với file môi trường khác trên PowerShell,
đặt `$env:ENV_FILE='.env.production'` trước lệnh. Không tự seed lại dữ liệu demo
trong mỗi lần CI/CD deploy.

Trên EC2 không cần cài Node riêng; sau khi workflow đã migrate và các dịch vụ phụ
thuộc chạy, có thể nạp dữ liệu một lần trong container:

```bash
cd /home/ubuntu/app
docker compose --env-file .env.production run --rm --no-deps server node prisma/seed.mjs
```

Chỉ thêm `--reset` sau `prisma/seed.mjs` nếu bạn chấp nhận xóa dữ liệu demo đang có.

### 7. Chạy NestJS

Development, tự reload:

```powershell
npm run dev
```

Production build:

```powershell
npm run build
npm run start
```

### 8. Kiểm tra server

```powershell
Invoke-RestMethod http://localhost:8011/api/v1/health
```

- Swagger: <http://localhost:8011/docs>
- API base URL: `http://localhost:8011/api/v1`
- RabbitMQ UI: <http://localhost:15672> (`vitacare` / `vitacare_local`)

## Tài khoản seed

Mật khẩu chung: `VitaCare@123`.

| Vai trò | Email |
| --- | --- |
| Admin | `admin@vitacare.local` |
| Quản lý chi nhánh | `manager@vitacare.local` |
| Bác sĩ Tim mạch | `doctor.cardio@vitacare.local` |
| Bác sĩ Nhi khoa | `doctor.pediatrics@vitacare.local` |
| Dược sĩ | `pharmacist@vitacare.local` |
| Thu ngân | `cashier@vitacare.local` |
| Lễ tân | `receptionist@vitacare.local` |
| Bệnh nhân | `patient@vitacare.local` |

## Dữ liệu seed đặt lịch và check-in

| Mã lịch | Trạng thái sau seed | Mục đích |
| --- | --- | --- |
| `VC-PED-BOOKED-QR` | `BOOKED` | Test cấp QR và check-in kiosk/lễ tân |
| `VC-PED-WAIT-01` | `CHECKED_IN` | Hàng đợi bác sĩ Nhi khoa |
| `VC-PED-WAIT-02` | `CHECKED_IN` | Hàng đợi bác sĩ Nhi khoa |
| `VC-SEED-WAIT-01` | `CHECKED_IN` | Hàng đợi bác sĩ Tim mạch |
| `VC-SEED-WAIT-02` | `CHECKED_IN` | Hàng đợi bác sĩ Tim mạch |

Phòng seed:

- `P101` — Phòng khám Nội 101
- `P102` — Phòng khám Nhi 102

Sau khi check-in `VC-PED-BOOKED-QR`, reset về `BOOKED` bằng:

```powershell
npm run prisma:seed -- --reset
```

## Flow QR check-in

1. Thanh toán thành công, lịch chuyển sang `BOOKED`.
2. Client lấy QR, số thứ tự dự kiến và phòng:

```http
GET /api/v1/appointments/:appointmentId/check-in-pass
```

3. Kiosk quét QR:

```http
POST /api/v1/check-in/kiosk/scan
```

4. Hoặc lễ tân đăng nhập và quét cùng QR:

```http
POST /api/v1/check-in/scan
```

Hai endpoint dùng chung transaction cấp số thứ tự và chuyển `BOOKED → CHECKED_IN`; chỉ khác `channel` là `KIOSK` hoặc `RECEPTIONIST`.

## Các lệnh thường dùng

```powershell
# Kiểm tra container
docker compose ps

# Dừng nhưng giữ dữ liệu
docker compose stop

# Chạy lại container đã tạo
docker compose start

# Mở Prisma Studio
npm run prisma:studio

# Kiểm tra build NestJS
npm run build
```

Không chạy `docker compose down -v` nếu không chủ động muốn xóa dữ liệu trong Docker volumes.

## Lỗi thường gặp

### `Can't reach database server at localhost:5432`

```powershell
docker compose up -d postgres
docker compose ps
```

### `EADDRINUSE :::8011`

```powershell
Get-NetTCPConnection -LocalPort 8011 | Select-Object LocalPort, OwningProcess
Stop-Process -Id <PID> -Force
```

### Backend không kết nối được MongoDB

Khởi động MongoDB local hoặc sửa `MONGODB_URI` trong `.env.development`.

### Seed xong nhưng bác sĩ không thấy bệnh nhân

Kiểm tra đúng tài khoản bác sĩ và ngày hệ thống, sau đó chạy lại:

```powershell
npm run prisma:seed -- --reset
```
