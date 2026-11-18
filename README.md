# VitaCare Clinic API (`be_clinic`)

Backend NestJS cho hệ thống phòng khám. PostgreSQL/Prisma lưu dữ liệu nghiệp vụ; Redis dùng cho cache; RabbitMQ dùng cho hàng đợi.

Tài liệu nghiệp vụ và kiến trúc được tập trung tại [docs/README.md](docs/README.md).

## Hiệu quả gói khám gợi ý

`GET /api/v1/analytics/recommendations` dành cho `CHAIN_MANAGER`/`SUPER_ADMIN`,
trả phễu hiển thị → bấm → tạo giữ chỗ → đặt thành công → thanh toán, theo nguồn và gói.
Hỗ trợ `timeFilter=today|week|month|quarter`, hoặc `startDate`, `endDate` (ngày Việt Nam,
bao gồm ngày kết thúc), tối đa 90 ngày. Hai tham số timestamp `start`, `end` cũ vẫn được hỗ trợ.
Đây là báo cáo toàn hệ thống, không áp dụng bộ lọc chi nhánh vì lượt gợi ý không gắn một cơ sở cụ thể.

Mỗi gói trong một lần gợi ý được đếm một lần ở mỗi bước. Khoảng ngày chọn tập lượt hiển thị;
kết quả đặt/thanh toán được liên kết với lượt bấm của tập đó. Checkout nhận `sourceViewId`
đã được backend xác nhận, trong cùng phiên và trong 24 giờ. Web/mobile ưu tiên lượt bấm
gợi ý đã xác nhận nếu không có lượt bấm tìm kiếm mới hơn. Không suy diễn chuyển đổi từ dữ liệu cũ thiếu liên kết.
Admin hiển thị báo cáo riêng trong tab phân tích nhu cầu; CVR lượt xem gói hiện tại vẫn giữ nguyên.

## Trợ lý đặt lịch OpenAI

Web và mobile dùng chung `POST /api/v1/ai/chat` với body
`{ "message": "Tìm lịch khám mắt" }` ở lượt đầu. Các lượt tiếp theo gửi thêm `sessionId` đã nhận.
Backend trả `sessionId`, `message`, `step` và các thẻ dịch vụ, bác sĩ hoặc đề xuất lịch.
Giữ `sessionId` cho các lượt tiếp theo; mở phiên mới khi đổi tài khoản.

Chatbot chỉ tư vấn và tra cứu, không tạo lịch, giữ chỗ hay thanh toán trong chat.
Nút “Tiếp tục đặt lịch” chuyển lựa chọn cơ sở, dịch vụ/bác sĩ, ngày và giờ sang luồng đặt lịch chung.
Trang/màn hình đặt lịch tải lại danh mục và lịch trống, chỉ điền sẵn lựa chọn còn hợp lệ.
Người dùng kiểm tra thông tin, chọn hồ sơ rồi xác nhận và thanh toán tại luồng chung;
backend vẫn kiểm tra quyền sở hữu hồ sơ, tính giá và kiểm tra slot khi checkout.
Endpoint `POST /api/v1/ai/booking/confirm` đã được bỏ; cập nhật web và mobile cùng backend.

Trợ lý dùng `OPENAI_API_KEY`, `OPENAI_MODEL` từ cấu hình `openai` hiện có;
không dùng Gemini. API key chỉ đặt ở backend. Nếu thiếu key, chat trả 503.
Hội thoại lưu trong PostgreSQL, không dùng Map trong RAM; không cần migration mới.
Đề xuất có hạn tham khảo 15 phút, không giữ slot và không bảo đảm còn chỗ khi chuyển trang.
Không truyền giá, thông tin bệnh nhân hoặc cờ tự checkout qua URL chuyển tiếp.
Redis giới hạn 20 tin nhắn/phút theo tài khoản hoặc IP khi được bật.
Các route chat/stream cũ đã được hợp nhất: deploy backend, web và bản mobile cùng phiên bản.

Mỗi tin nhắn được OpenAI phân luồng bằng JSON Schema trước khi chạy tools:

- `DIRECT`: yêu cầu dịch vụ/thông tin rõ ràng, tiếp tục tra cứu ngay.
- `CLARIFY`: mô tả triệu chứng còn thiếu thông tin, hỏi tối đa 1–2 câu mỗi lượt; không chạy tools tìm dịch vụ/lịch.
- `READY`: đủ ngữ cảnh để hỗ trợ định hướng chuyên khoa, tra cứu dịch vụ thực tế; chưa cho tìm lịch cho đến khi người dùng chọn dịch vụ/bác sĩ.
- `URGENT`: dừng tra cứu và hướng dẫn tìm hỗ trợ y tế khẩn cấp.

Quy tắc và schema nằm trong `src/modules/ai-assistant/ai-intake.ts`. Phân luồng dùng
ngữ cảnh 12 tin nhắn gần nhất, không ép hỏi đủ số câu; đánh giá lại khi đổi triệu chứng/người khám.
Đây là hỗ trợ chọn dịch vụ, không phải chẩn đoán hay xác nhận tình trạng an toàn.
Mỗi lượt chat có thêm một lần gọi OpenAI để phân luồng, dùng chung giới hạn 45 giây
với bước tra cứu. Phản hồi phân luồng lỗi, thiếu hoặc bị từ chối sẽ trả 503, không tự bỏ qua để tìm lịch.

## Yêu cầu

- Node.js 22+
- npm 10+
- Docker Desktop

| Dịch vụ | Cổng mặc định |
| --- | ---: |
| NestJS API | `8011` |
| PostgreSQL | `5432` |
| Redis | `6379` |
| RabbitMQ | `5672` |
| RabbitMQ Management | `15672` |

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
Chỉ có một script seed `prisma/seed.mjs`; các JSON trong `prisma/data/` giữ danh mục
cơ sở, bác sĩ, bệnh nhân và dịch vụ. Seed tạo đúng 10 lịch cho tài khoản
`patient@vitacare.local`, tính ngày tương đối theo thời điểm chạy tại Việt Nam.
Lịch xác nhận nằm ở tương lai; lịch đã hoàn tất hoặc vắng mặt nằm ở quá khứ.
Nếu chủ động muốn XÓA toàn bộ dữ liệu hiện tại và nạp lại bộ demo:

```powershell
npm run prisma:seed -- --reset
```

Seed dùng `.env.development` mặc định. Với file môi trường khác trên PowerShell,
đặt `$env:ENV_FILE='.env.production'` trước lệnh. Không tự seed lại dữ liệu demo
trong mỗi lần CI/CD deploy.

Nếu database development vẫn lưu lịch sử migration cũ, `seed --reset` chỉ nạp lại
dữ liệu, không đồng bộ lịch sử migration. Để chuyển database demo đó sang baseline
mới, dừng backend và chỉ chạy hai lệnh sau khi chấp nhận xóa toàn bộ dữ liệu:

```powershell
npx prisma migrate reset --force
npm run prisma:seed
```

Không chạy `migrate deploy` với baseline đã gộp lên database đang giữ migration cũ.

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
| Lễ tân | `receptionist@vitacare.local` |
| Bệnh nhân | `patient@vitacare.local` |

## Dữ liệu seed đặt lịch và check-in

| Mã lịch | Trạng thái sau seed | Mục đích |
| --- | --- | --- |
| `VC-DEMO-01` | `HOLD` | Chờ thanh toán, giữ chỗ 15 phút, lịch tương lai |
| `VC-DEMO-02` | `CONFIRMED` | Khám Mắt, đã thanh toán, lịch tương lai |
| `VC-DEMO-03` | `CONFIRMED` | Gói tổng quát, khung tiếp nhận giới hạn 5 người, không bác sĩ/phòng/STT |
| `VC-DEMO-04` | `CONFIRMED` | Tư vấn online, lịch tương lai |
| `VC-DEMO-05` | `CHECKED_IN` | Đã tiếp nhận, đang chờ nhân viên/bác sĩ xử lý |
| `VC-DEMO-06` | `COMPLETED` | Gói tổng quát đã khám xong hôm trước |
| `VC-DEMO-07` | `CANCELLED` | Hủy trước 24 giờ, hoàn 95%, chờ chuyển tiền |
| `VC-DEMO-08` | `CANCELLED` | Hủy trước 3 giờ, hoàn 80%, chờ chuyển tiền, cơ sở Đông |
| `VC-DEMO-09` | `EXPIRED` | Hết hạn giữ chỗ, chưa thanh toán |
| `VC-DEMO-10` | `NO_SHOW` | Không đến khám, đã thanh toán, không tạo khoản hoàn |

Phòng seed:

- `P101` — Phòng khám Nội 101
- `P102` — Phòng khám Nhi 102

Để khôi phục toàn bộ dữ liệu demo và cập nhật ngày theo thời điểm chạy:

```powershell
npm run prisma:seed -- --reset
```

## Flow QR check-in

1. Thanh toán thành công, lịch chuyển sang `CONFIRMED`.
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

Hai endpoint dùng chung transaction cấp số thứ tự và chuyển `CONFIRMED → CHECKED_IN`; chỉ khác `channel` là `KIOSK` hoặc `RECEPTIONIST`.

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

### Seed xong nhưng bác sĩ không thấy bệnh nhân

Kiểm tra đúng tài khoản bác sĩ và ngày hệ thống, sau đó chạy lại:

```powershell
npm run prisma:seed -- --reset
```
