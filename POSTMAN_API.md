# be_clinic API cho Postman

Tất cả endpoint bên dưới đều dùng base URL:

```text
http://localhost:5000/api
```

## Headers chung

- `Content-Type: application/json`
- Với API cần đăng nhập: `Authorization: Bearer <JWT>`

## Quy ước payload

- Các field có dấu `?` là không bắt buộc.
- Các giá trị ngày dùng định dạng `YYYY-MM-DD`.
- Các giá trị giờ dùng định dạng `HH:mm`.

## 1. Health

### GET `/health`

Không cần auth.

Response mẫu:

```json
{ "ok": true, "service": "be_clinic" }
```

## 2. Auth

### POST `/auth/register`

Không cần auth.

Body:

```json
{
  "firstName": "An",
  "lastName": "Nguyen",
  "email": "an@gmail.com",
  "phone": "0912345678",
  "password": "123456"
}
```

Ghi chú:
- Tạo tài khoản bệnh nhân.
- Trả về `verificationToken`, `email`, `emailMask`.

### POST `/auth/start-register`

Không cần auth.

Body:

```json
{
  "email": "an@gmail.com"
}
```

Ghi chú:
- Bắt đầu luồng đăng ký OTP trước.
- Trả về `verificationToken`, `email`, `emailMask`.

### POST `/auth/verify-email`

Không cần auth.

Body:

```json
{
  "verificationToken": "jwt-token-o-day",
  "otp": "123456"
}
```

Ghi chú:
- Nếu đi theo luồng `start-register`, response sẽ trả `completeToken`.
- Nếu đi theo luồng `register`, response có thể trả thẳng `token` đăng nhập.

### POST `/auth/complete-register`

Không cần auth.

Body:

```json
{
  "completeToken": "jwt-token-o-day",
  "firstName": "An",
  "lastName": "Nguyen",
  "phone": "0912345678",
  "password": "123456"
}
```

Ghi chú:
- Hoàn tất đăng ký sau khi OTP đúng.

### POST `/auth/resend-otp`

Không cần auth.

Body:

```json
{
  "email": "an@gmail.com"
}
```

### POST `/auth/login`

Không cần auth.

Body:

```json
{
  "email": "an@gmail.com",
  "password": "123456"
}
```

Ghi chú:
- Field `email` có thể là email hoặc số điện thoại.

### POST `/auth/staff-login`

Không cần auth.

Body:

```json
{
  "email": "doctor@example.com",
  "password": "123456"
}
```

Ghi chú:
- Chỉ dùng cho nhân viên/bác sĩ.

### GET `/auth/me`

Auth bắt buộc.

Không có body.

### PATCH `/auth/me`

Auth bắt buộc.

Body:

```json
{
  "dob": "1995-01-01",
  "gender": "nam",
  "ethnicity": "Kinh",
  "citizenId": "012345678",
  "address": "Quận 1, TP.HCM"
}
```

Ghi chú:
- `gender` chấp nhận `nam`, `male`, `m`, `true`, `nữ`, `nu`, `female`, `f`, `false`, hoặc boolean.

## 3. Doctors

### GET `/doctors`

Không cần auth.

Không có body.

Response chính:

```json
{
  "doctors": [
    {
      "id": "...",
      "email": "doctor@example.com",
      "firstName": "Minh",
      "lastName": "Tran",
      "displayName": "Tran Minh",
      "bio": "...",
      "avatarUrl": "...",
      "experienceYears": 5,
      "consultationFee": 150000,
      "specialtyName": "Nội khoa",
      "specialtyID": "...",
      "deptID": "...",
      "deptName": "...",
      "clinicRoomID": "...",
      "clinicRoomName": "..."
    }
  ]
}
```

## 4. Clinic rooms

### GET `/clinic-rooms`

Không cần auth.

Query params:

- `activeOnly`? mặc định `true`

Ví dụ:

```text
/api/clinic-rooms?activeOnly=false
```

Response chính:

```json
{
  "rooms": [
    {
      "roomID": "P101",
      "name": "Phòng 101",
      "building": "A",
      "floor": "1",
      "notes": "",
      "sortOrder": 1,
      "isActive": true
    }
  ]
}
```

## 5. Appointments

### GET `/appointments/my`

Auth bắt buộc.

Chỉ bệnh nhân.

Không có body.

### GET `/appointments/doctor`

Auth bắt buộc.

Chỉ bác sĩ.

Không có body.

### GET `/appointments/lookup-ticket`

Auth bắt buộc.

Chỉ receptionist.

Query params:

- `ticket` bắt buộc

Ví dụ:

```text
/api/appointments/lookup-ticket?ticket=YMA260411A1B2C3
```

### GET `/appointments/patient-by-code`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Query params:

- `code` bắt buộc

Ví dụ:

```text
/api/appointments/patient-by-code?code=YM261234ABCD1234
```

### GET `/appointments/patients`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Query params:

- `page`? mặc định `1`
- `pageSize`? mặc định `10`, tối đa `50`
- `patientCode`?
- `name`?
- `phone`?
- `account`? email

Ví dụ:

```text
/api/appointments/patients?page=1&pageSize=10&name=an
```

### GET `/appointments/patient-history`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Query params:

- `patientId` bắt buộc

### GET `/appointments/reception`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Query params:

- `from`? `YYYY-MM-DD`
- `to`? `YYYY-MM-DD`
- `status`? `pending` | `confirmed` | `cancelled` | `all`
- `q`?

Ví dụ:

```text
/api/appointments/reception?from=2026-08-01&to=2026-08-31&status=all
```

### GET `/appointments/availability`

Auth bắt buộc.

Query params:

- `doctorId` bắt buộc
- `date` bắt buộc, `YYYY-MM-DD`

Ví dụ:

```text
/api/appointments/availability?doctorId=66b...&date=2026-08-08
```

### GET `/appointments/schedule-dates`

Auth bắt buộc.

Query params:

- `doctorId` bắt buộc
- `from`? `YYYY-MM-DD`
- `to`? `YYYY-MM-DD`

Ví dụ:

```text
/api/appointments/schedule-dates?doctorId=66b...&from=2026-08-01&to=2026-08-31
```

### POST `/appointments`

Auth bắt buộc.

Chỉ bệnh nhân.

Body:

```json
{
  "doctorId": "66b...",
  "appointmentDate": "2026-08-08",
  "startTime": "08:00",
  "note": "Đau đầu 3 ngày"
}
```

### POST `/appointments/reception`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Body khi bệnh nhân đã tồn tại:

```json
{
  "patientEmailOrPhone": "0912345678",
  "doctorId": "66b...",
  "appointmentDate": "2026-08-08",
  "startTime": "08:00",
  "note": "Đặt giúp bệnh nhân"
}
```

Body khi cần tạo mới bệnh nhân:

```json
{
  "patientEmailOrPhone": "newpatient@gmail.com",
  "patient": {
    "displayName": "Nguyen Van A",
    "phone": "0912345678",
    "email": "newpatient@gmail.com",
    "dob": "1995-01-01",
    "gender": "nam",
    "address": "TP.HCM"
  },
  "doctorId": "66b...",
  "appointmentDate": "2026-08-08",
  "startTime": "08:00",
  "note": "Khám lần đầu"
}
```

Ghi chú:
- Nếu bệnh nhân mới được tạo, backend dùng mật khẩu mặc định `111111`.
- Email của bệnh nhân mới phải là `@gmail.com`.

### PATCH `/appointments/:id/status`

Auth bắt buộc.

Chỉ receptionist hoặc registration.

Body:

```json
{
  "status": "confirmed",
  "visitQueueNumber": 1,
  "clinicRoom": "P101"
}
```

Body hủy lịch:

```json
{
  "status": "cancelled",
  "reason": "Bệnh nhân bận"
}
```

Ghi chú:
- `status` chỉ nhận `pending`, `confirmed`, `cancelled`.
- `visitQueueNumber` có thể để trống để backend tự gán.
- `clinicRoom` tối đa 80 ký tự.
- `reason` hoặc `cancelReason` tối đa 500 ký tự.

### PATCH `/appointments/:id/cancel`

Auth bắt buộc.

Chỉ bệnh nhân.

Body:

```json
{
  "cancelReason": "Bận việc đột xuất"
}
```

Hoặc:

```json
{
  "reason": "Bận việc đột xuất"
}
```

## 6. Examinations

### POST `/examinations`

Auth bắt buộc.

Chỉ bác sĩ.

Body tối thiểu:

```json
{
  "appointmentId": "66b..."
}
```

Body đầy đủ:

```json
{
  "appointmentId": "66b...",
  "symptoms": "Sốt, ho",
  "diagnosis": "Viêm hô hấp",
  "treatment": "Uống thuốc 5 ngày",
  "note": "Theo dõi thêm",
  "examAt": "2026-08-08 08:15",
  "clinicRoom": "P101",
  "temp": "37.8",
  "breath": "20",
  "bp": "120/80",
  "pulse": "80",
  "height": "170",
  "weight": "65",
  "bmi": "22.5",
  "spo2": "98",
  "reExamination": "2026-08-15"
}
```

Ghi chú:
- `note` hoặc `notes` đều được chấp nhận, backend sẽ lấy một trong hai.
- `reExamination` là ngày tái khám, nếu truyền sai định dạng thì backend bỏ qua.
- Một `appointmentId` chỉ có một bản ghi examination, backend sẽ upsert.

## 7. Mẫu nhanh cho Postman

### Login rồi dùng token

1. Gọi `POST /auth/login`
2. Copy giá trị `token` từ response
3. Dán vào header:

```text
Authorization: Bearer <token>
```

### Body JSON mẫu cho request có auth

```json
{
  "doctorId": "66b...",
  "appointmentDate": "2026-08-08",
  "startTime": "08:00"
}
```

### Gợi ý Postman Collection

- Auth
- Doctors
- Clinic Rooms
- Appointments
- Examinations
