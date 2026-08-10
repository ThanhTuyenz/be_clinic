# VitaCare database architecture audit

## 1. Kết luận điều hành

Schema hiện tại đã có khóa chính, khóa ngoại và kiểu dữ liệu nền tảng tương đối tốt, nhưng chưa đạt 3NF hoàn toàn. Bốn vấn đề cần ưu tiên là:

1. `appointments` lặp `doctor_id` và `branch_id`, trong khi hai giá trị này đã được xác định bởi `schedule_slot_id -> doctor_schedules`.
2. `medical_visits.payload` chứa chẩn đoán, đơn thuốc và chỉ định dưới dạng JSON; PostgreSQL không thể tạo FK tới `medicines`, `icd10_codes` và `medical_services`.
3. `medicines.stock_quantity` là tồn kho toàn hệ thống, không thể biểu diễn tồn kho theo chi nhánh và không có sổ biến động.
4. `users.role`/`users.role_id` và hai cơ chế OTP đang cùng tồn tại, tạo hai nguồn sự thật cho auth.

Không nên xóa tất cả quan hệ tam giác. Một số cột là snapshot nghiệp vụ bắt buộc, đặc biệt `invoices.branch_id`, `invoices.patient_profile_id` và `medical_visits.medical_record_id`.

## 2. Phân loại vấn đề

### Nghiêm trọng

| Vấn đề | Tác động | Giải pháp đích |
|---|---|---|
| `Appointment.doctorId` và `branchId` lặp từ schedule | Có thể tạo lịch của bác sĩ A nhưng slot của bác sĩ B | Bỏ hai cột sau giai đoạn tương thích; lấy qua `scheduleSlot.schedule` |
| `@@unique([scheduleSlotId, queueNumber])` | STT bị unique theo slot, trong khi nghiệp vụ cấp STT theo phòng/ngày | Tạo `VisitQueueCounter(workDate, roomId)` và unique `(workDate, roomId, queueNumber)` trên visit/check-in |
| Đơn thuốc/chỉ định trong JSON | Không FK, khó thống kê, có thể tham chiếu thuốc/dịch vụ không tồn tại | Tách `Prescription`, `PrescriptionItem`, `ClinicalOrder` |
| `Medicine.stockQuantity` toàn cục | Sai tồn kho khi có nhiều chi nhánh | Tách `InventoryStock` và `InventoryMovement` |
| `User.role` và `roleId` cùng tồn tại | Phân quyền có thể trả hai kết quả khác nhau | Chọn một nguồn: enum role cho 7 role cố định, hoặc bảng Role/Permission; dự án này nên dùng enum + custom permissions |
| OTP vừa nằm trên `users`, vừa có `auth_verification_tokens` | Hai luồng xác thực và chính sách hết hạn khác nhau | Chuyển hết sang token table có `purpose`, xóa dần OTP fields trên User |

### Cảnh báo

| Vấn đề | Tác động | Đề xuất |
|---|---|---|
| `MedicalVisit` bắt buộc `appointmentId` | Không nhập được hồ sơ cũ/cấp cứu/walk-in | Cho `appointmentId` nullable, vẫn unique khi có giá trị |
| `MedicalVisit` có cả medical record và appointment | Tam giác với patient | Giữ vì đây là ownership lâm sàng; thêm trigger kiểm tra cùng patient |
| Invoice lặp patient/branch từ appointment | Không thuần 3NF | Giữ như snapshot kế toán; không cascade khi lịch thay đổi |
| AppointmentStatus chứa `REFUND_REQUIRED`, `MANUAL_REVIEW` | Trộn trạng thái đặt lịch với thanh toán | Đưa về PaymentStatus/PaymentReconciliationStatus |
| `Session.expiresAt` nullable | Session có thể sống vô hạn nếu code lỗi | Bắt buộc NOT NULL |
| Search `ILIKE '%q%'` | B-tree không hỗ trợ tốt ở dữ liệu lớn | `pg_trgm` + GIN index cho tên thuốc, bệnh nhân, dịch vụ, ICD description |
| Audit/outbox tăng không giới hạn | Bảng và index phình lớn | Retention + partition theo tháng |

### Gợi ý

- Đổi `Doctor.departmentId` thành `primaryDepartmentId` để thể hiện đây là khoa công tác chính, không phải khoa suy ra từ mọi specialty.
- Thêm `version Int @default(0)` cho Appointment/MedicalVisit nếu cần optimistic locking.
- Thêm `finalizedAt`, `finalizedById` và trạng thái DRAFT/FINALIZED/AMENDED cho hồ sơ khám.
- Dùng partial unique index để mỗi account chỉ có một main patient profile.

## 3. Đánh giá 3NF

| Model | Đánh giá | Lý do |
|---|---|---|
| Clinic, Branch, ClinicRoom | Đạt 3NF | Thuộc tính phụ thuộc trực tiếp PK |
| UserBranchAssignment, DoctorBranchAssignment, DoctorSpecialty | Đạt 3NF | Bảng nối rõ ràng, unique đúng |
| DoctorScheduleTemplate, DoctorSchedule, DoctorScheduleSlot | Gần 3NF | Cấu trúc tốt; counter là dữ liệu dẫn xuất có kiểm soát transaction |
| Appointment | Chưa đạt | `scheduleSlotId -> schedule -> doctorId, branchId`, nhưng hai cột vẫn lặp trong Appointment |
| Invoice | Cố ý phi chuẩn hóa | Patient/branch là snapshot kế toán; giữ lại có lý do nghiệp vụ |
| MedicalRecord | Đạt 3NF | Một record trên một patient profile |
| MedicalVisit | Chưa đạt | payload JSON chứa nhiều tập lặp và thực thể độc lập |
| Medicine | Chưa đạt trong hệ thống đa chi nhánh | stockQuantity phụ thuộc cả medicine và branch, không chỉ medicine |
| PaymentTransaction | Đạt 3NF | Mỗi transaction thuộc một invoice; tiền dùng Decimal |
| OutboxEvent, ProcessedEvent | Đạt theo mô hình messaging | ID logic cố ý không dùng FK đa hình |
| User/Auth | Chưa đạt hoàn toàn | role/provider/OTP có hai nguồn sự thật |

## 4. Quan hệ tam giác

### Nên loại bỏ

```text
Appointment ───── doctorId ─────> Doctor
     └─ scheduleSlot ─> schedule ─> Doctor
```

`Appointment.doctorId` dư vì một slot chỉ thuộc một schedule và một doctor.

```text
Appointment ───── branchId ─────> Branch
     └─ scheduleSlot ─> schedule ─> Branch
```

`Appointment.branchId` dư vì branch đã được khóa tại schedule.

### Nên giữ

```text
Invoice ── appointment ──> Appointment
   ├────── patient ──────> PatientProfile
   └────── branch ───────> Branch
```

Giữ patient và branch trên hóa đơn làm snapshot pháp lý/kế toán. Không nên để việc sửa lịch hẹn làm thay đổi chủ thể hóa đơn đã phát hành.

```text
MedicalVisit ── appointment ──> Appointment ──> PatientProfile
      └──────── medicalRecord ────────────────> PatientProfile
```

Giữ `medicalRecordId`; làm `appointmentId` nullable. Medical visit phải sống độc lập với hệ thống booking.

```text
Doctor ── primaryDepartment ──> Department
   └──── specialties ─────────> Specialty ──> Department
```

Giữ nếu `primaryDepartment` là khoa biên chế/công tác chính. Đổi tên để ý nghĩa không mơ hồ.

## 5. Kiểu dữ liệu và constraint

- UUID phù hợp cho entity phân tán/công khai: User, Appointment, Payment, MedicalRecord. BIGINT phù hợp bảng con nội bộ tăng nhanh: histories, invoice items.
- Tiền phải dùng `Decimal(12,2)` hoặc lớn hơn; không dùng Float. `ratingAverage Float` chấp nhận được cho thống kê, nhưng `Decimal(3,2)` cho kết quả ổn định hơn.
- `TIMESTAMPTZ` đúng cho sự kiện; `DATE` đúng cho ngày khám; `TIME` đúng cho template/slot. Khi ghép DATE + TIME phải sử dụng timezone của Branch.
- `VARCHAR` dùng cho mã/tên có giới hạn; `TEXT` dùng mô tả, ghi chú. Không index B-tree trực tiếp TEXT cho contains search.
- Token/password/OTP chỉ lưu hash; không log raw token. Refresh token hash và session expiry nên NOT NULL.
- `onDelete: Restrict` đúng cho Appointment -> Doctor/Slot và Invoice -> Appointment; dữ liệu y tế/tài chính không nên cascade theo master data.
- `Cascade` phù hợp cho bảng nối, token phụ thuộc và item phụ thuộc cha.

## 6. Index đích

```sql
CREATE INDEX appointments_doctor_status_created_idx
  ON appointments (doctor_id, status, created_at DESC); -- chỉ trong giai đoạn còn doctor_id

CREATE INDEX appointments_patient_created_idx
  ON appointments (patient_profile_id, created_at DESC);

CREATE INDEX schedules_doctor_branch_date_status_idx
  ON doctor_schedules (doctor_id, branch_id, work_date, status);

CREATE INDEX payments_invoice_status_created_idx
  ON payment_transactions (invoice_id, status, created_at DESC);

CREATE INDEX outbox_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE status = 'PENDING';

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX medicines_search_trgm_idx
  ON medicines USING gin ((name || ' ' || coalesce(active_ingredient, '')) gin_trgm_ops);
CREATE INDEX patient_profiles_name_trgm_idx
  ON patient_profiles USING gin (full_name gin_trgm_ops);
```

Không tạo index riêng trên mọi FK một cách máy móc; chỉ tạo khi FK là cột đầu của query/filter hoặc cần tối ưu delete/update ở bảng cha.

## 7. Schema đích cho các model cần tái cấu trúc

Các model không xuất hiện bên dưới giữ nguyên như schema chạy hiện tại trong `prisma/schema`. Đây là change-set hoàn chỉnh cho phần cần chuẩn hóa; không áp trực tiếp trước khi chuyển code đọc/ghi kép.

```prisma
enum MedicalVisitStatus {
  DRAFT
  FINALIZED
  AMENDED
}

enum PrescriptionStatus {
  DRAFT
  ISSUED
  CANCELLED
}

enum ClinicalOrderStatus {
  ORDERED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum InventoryMovementType {
  IMPORT
  DISPENSE
  ADJUSTMENT
  RETURN
  EXPIRED
}

model Appointment {
  id                  String            @id @default(uuid()) @db.Uuid
  bookingCode         String?           @unique @map("booking_code") @db.VarChar(30)
  patientProfileId    String            @map("patient_profile_id") @db.Uuid
  scheduleSlotId      String            @map("schedule_slot_id") @db.Uuid
  symptomsDescription String?           @map("symptoms_description") @db.Text
  bookedViaAi         Boolean           @default(false) @map("booked_via_ai")
  status              AppointmentStatus @default(PENDING_PAYMENT)
  holdExpiresAt       DateTime?         @map("hold_expires_at") @db.Timestamptz(3)
  checkedInAt         DateTime?         @map("checked_in_at") @db.Timestamptz(3)
  checkedInById       String?           @map("checked_in_by_id") @db.Uuid
  createdAt           DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)
  patientProfile      PatientProfile    @relation(fields: [patientProfileId], references: [id], onDelete: Restrict)
  scheduleSlot        DoctorScheduleSlot @relation(fields: [scheduleSlotId], references: [id], onDelete: Restrict)
  checkedInBy         User?             @relation("CheckedInBy", fields: [checkedInById], references: [id], onDelete: SetNull)
  invoice             Invoice?
  medicalVisit        MedicalVisit?
  statusHistories     AppointmentStatusHistory[]
  qrToken             AppointmentQrToken?

  @@index([patientProfileId, createdAt])
  @@index([scheduleSlotId, status])
  @@index([status, holdExpiresAt])
  @@map("appointments")
}

model MedicalVisit {
  id                String             @id @default(uuid()) @db.Uuid
  medicalRecordId   String             @map("medical_record_id") @db.Uuid
  appointmentId     String?            @unique @map("appointment_id") @db.Uuid
  doctorId          String             @map("doctor_id") @db.Uuid
  branchId          String             @map("branch_id") @db.Uuid
  status            MedicalVisitStatus @default(DRAFT)
  symptoms          String?            @db.Text
  clinicalNotes     String?            @map("clinical_notes") @db.Text
  treatmentPlan     String?            @map("treatment_plan") @db.Text
  followUpAt        DateTime?          @map("follow_up_at") @db.Timestamptz(3)
  finalizedAt       DateTime?          @map("finalized_at") @db.Timestamptz(3)
  createdById       String             @map("created_by_id") @db.Uuid
  createdAt         DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt         DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  medicalRecord     MedicalRecord      @relation(fields: [medicalRecordId], references: [id], onDelete: Restrict)
  appointment       Appointment?       @relation(fields: [appointmentId], references: [id], onDelete: SetNull)
  doctor            Doctor             @relation(fields: [doctorId], references: [id], onDelete: Restrict)
  branch            Branch             @relation(fields: [branchId], references: [id], onDelete: Restrict)
  createdBy         User               @relation("MedicalVisitCreator", fields: [createdById], references: [id], onDelete: Restrict)
  vitals            VisitVitals?
  diagnoses         VisitDiagnosis[]
  prescription      Prescription?
  clinicalOrders    ClinicalOrder[]

  @@index([medicalRecordId, createdAt])
  @@index([doctorId, status, createdAt])
  @@index([branchId, createdAt])
  @@map("medical_visits")
}

model VisitVitals {
  medicalVisitId String   @id @map("medical_visit_id") @db.Uuid
  temperature    Decimal? @db.Decimal(4, 1)
  respiratoryRate Int?    @map("respiratory_rate")
  systolicBp     Int?     @map("systolic_bp")
  diastolicBp    Int?     @map("diastolic_bp")
  pulse          Int?
  heightCm       Decimal? @map("height_cm") @db.Decimal(5, 2)
  weightKg       Decimal? @map("weight_kg") @db.Decimal(5, 2)
  spo2           Decimal? @db.Decimal(5, 2)
  medicalVisit   MedicalVisit @relation(fields: [medicalVisitId], references: [id], onDelete: Cascade)

  @@map("visit_vitals")
}

model VisitDiagnosis {
  id             BigInt      @id @default(autoincrement())
  medicalVisitId String      @map("medical_visit_id") @db.Uuid
  icd10CodeId    String      @map("icd10_code_id") @db.Uuid
  isPrimary      Boolean     @default(false) @map("is_primary")
  note           String?     @db.Text
  medicalVisit   MedicalVisit @relation(fields: [medicalVisitId], references: [id], onDelete: Cascade)
  icd10Code      Icd10Code   @relation(fields: [icd10CodeId], references: [id], onDelete: Restrict)

  @@unique([medicalVisitId, icd10CodeId])
  @@index([icd10CodeId])
  @@map("visit_diagnoses")
}

model Prescription {
  id             String             @id @default(uuid()) @db.Uuid
  medicalVisitId String             @unique @map("medical_visit_id") @db.Uuid
  status         PrescriptionStatus @default(DRAFT)
  note           String?            @db.Text
  issuedAt       DateTime?          @map("issued_at") @db.Timestamptz(3)
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  medicalVisit   MedicalVisit       @relation(fields: [medicalVisitId], references: [id], onDelete: Cascade)
  items          PrescriptionItem[]

  @@map("prescriptions")
}

model PrescriptionItem {
  id               BigInt       @id @default(autoincrement())
  prescriptionId   String       @map("prescription_id") @db.Uuid
  medicineId       String       @map("medicine_id") @db.Uuid
  medicineName     String       @map("medicine_name") @db.VarChar(255) // snapshot khi phát hành
  strength         String?      @db.VarChar(100)                         // snapshot
  unit             String?      @db.VarChar(50)                          // snapshot
  quantity         Decimal      @db.Decimal(10, 2)
  dosageAmount     String       @map("dosage_amount") @db.VarChar(100)
  frequencyPerDay  Int?         @map("frequency_per_day")
  durationDays     Int?         @map("duration_days")
  instructions     String?      @db.Text
  prescription     Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)
  medicine         Medicine     @relation(fields: [medicineId], references: [id], onDelete: Restrict)

  @@index([prescriptionId])
  @@index([medicineId])
  @@map("prescription_items")
}

model ClinicalOrder {
  id               String              @id @default(uuid()) @db.Uuid
  medicalVisitId   String              @map("medical_visit_id") @db.Uuid
  medicalServiceId String              @map("medical_service_id") @db.Uuid
  status           ClinicalOrderStatus @default(ORDERED)
  serviceName      String              @map("service_name") @db.VarChar(200) // snapshot
  price            Decimal             @db.Decimal(12, 2)                    // snapshot
  note             String?             @db.Text
  resultPayload    Json?               @map("result_payload")
  orderedAt        DateTime            @default(now()) @map("ordered_at") @db.Timestamptz(3)
  completedAt      DateTime?           @map("completed_at") @db.Timestamptz(3)
  medicalVisit     MedicalVisit        @relation(fields: [medicalVisitId], references: [id], onDelete: Cascade)
  medicalService   MedicalService      @relation(fields: [medicalServiceId], references: [id], onDelete: Restrict)

  @@index([medicalVisitId, status])
  @@index([medicalServiceId, orderedAt])
  @@map("clinical_orders")
}

model Medicine {
  id               String             @id @default(uuid()) @db.Uuid
  code             String             @unique @db.VarChar(50)
  name             String             @db.VarChar(255)
  activeIngredient String?            @map("active_ingredient") @db.VarChar(255)
  strength         String?            @db.VarChar(100)
  unit             String?            @db.VarChar(50)
  unitPrice        Decimal            @default(0) @map("unit_price") @db.Decimal(12, 2)
  isActive         Boolean            @default(true) @map("is_active")
  createdAt        DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  prescriptionItems PrescriptionItem[]
  stocks           InventoryStock[]
  movements        InventoryMovement[]

  @@index([isActive, name])
  @@map("medicines")
}

model InventoryStock {
  branchId   String   @map("branch_id") @db.Uuid
  medicineId String   @map("medicine_id") @db.Uuid
  quantity   Decimal  @default(0) @db.Decimal(14, 2)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  branch     Branch   @relation(fields: [branchId], references: [id], onDelete: Restrict)
  medicine   Medicine @relation(fields: [medicineId], references: [id], onDelete: Restrict)

  @@id([branchId, medicineId])
  @@map("inventory_stocks")
}

model InventoryMovement {
  id          BigInt                @id @default(autoincrement())
  branchId    String                @map("branch_id") @db.Uuid
  medicineId  String                @map("medicine_id") @db.Uuid
  type        InventoryMovementType
  quantity    Decimal               @db.Decimal(14, 2)
  referenceId String?               @map("reference_id") @db.VarChar(100)
  note        String?               @db.Text
  createdById String                @map("created_by_id") @db.Uuid
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  branch      Branch                @relation(fields: [branchId], references: [id], onDelete: Restrict)
  medicine    Medicine              @relation(fields: [medicineId], references: [id], onDelete: Restrict)
  createdBy   User                  @relation(fields: [createdById], references: [id], onDelete: Restrict)

  @@index([branchId, medicineId, createdAt])
  @@index([referenceId])
  @@map("inventory_movements")
}
```

## 8. Security

### Trạng thái nghiệp vụ

- Appointment nên chỉ phản ánh vòng đời khám: `PENDING_PAYMENT -> BOOKED -> CHECKED_IN -> IN_EXAMINATION -> COMPLETED`; nhánh cuối gồm `CANCELLED`, `EXPIRED`, `NO_SHOW`.
- `REFUND_REQUIRED` và `MANUAL_REVIEW` không phải trạng thái khám; chuyển sang trạng thái đối soát thanh toán để tránh appointment bị kẹt ngoài state machine.
- Invoice gồm `UNPAID`, `PAID`, `REFUNDED`, `CANCELLED` là đủ ở phạm vi hiện tại; nếu hoàn một phần, bổ sung `PARTIALLY_REFUNDED` và lưu refund transaction riêng.
- PaymentTransaction đã bao quát late success/refund/manual review, nhưng cần bảng status history hoặc append-only provider events để điều tra webhook.
- MedicalVisit cần DRAFT/FINALIZED/AMENDED; hồ sơ FINALIZED không được update trực tiếp mà phải tạo amendment/audit.
- Prescription và ClinicalOrder cần state machine độc lập như schema đích.

### Ma trận onDelete đề xuất

| Quan hệ | onDelete | Lý do |
|---|---|---|
| User -> Session/OAuth/token | CASCADE | Dữ liệu auth phụ thuộc hoàn toàn user |
| User -> PatientProfile | SET NULL | Hồ sơ bệnh nhân/y tế phải tồn tại khi account bị gỡ |
| Doctor/Branch/Slot -> Appointment | RESTRICT | Không xóa master khi đã phát sinh lịch |
| Appointment -> Invoice | RESTRICT | Bảo toàn chứng từ tài chính |
| Appointment -> MedicalVisit | SET NULL | Lần khám vẫn tồn tại nếu booking được ẩn/xóa theo chính sách |
| MedicalRecord -> MedicalVisit | RESTRICT | Không cascade xóa bệnh án |
| MedicalVisit -> vitals/diagnoses/prescription/orders | CASCADE | Thành phần aggregate phụ thuộc visit; production nên archive thay vì hard delete visit |
| Medicine/MedicalService -> item/order | RESTRICT | Không làm mất lịch sử kê thuốc/chỉ định |
| Catalog master -> mapping tables | CASCADE hoặc soft delete | Chỉ cascade khi chưa có dữ liệu nghiệp vụ |

- `password_hash`, refresh token, OTP và reset token phải dùng Argon2id/bcrypt/HMAC-SHA256 tùy loại; không mã hóa có thể giải ngược.
- Không trả `password`, `hash`, `emailOtpHash`, token hash trong DTO/API/log.
- OTP: TTL 5–10 phút, giới hạn lần thử, resend cooldown, consumedAt một lần.
- Session: rotate refresh token khi refresh; revoke toàn bộ session khi đổi mật khẩu.
- Dữ liệu bệnh án cần audit append-only cho hành động đọc/sửa/in; phân quyền theo doctor assignment và patient ownership.
- PostgreSQL production nên mã hóa disk/backup, TLS connection, tách DB user migration và runtime.

## 9. Scalability

- Partition `audit_logs`, `outbox_events`, `appointment_status_histories`, `inventory_movements` theo tháng khi đạt hàng triệu dòng.
- Outbox publisher cần `FOR UPDATE SKIP LOCKED` để nhiều worker không lấy cùng event.
- Archive PUBLISHED outbox sau 30–90 ngày; processed events giữ theo thời gian retry tối đa của broker.
- Dashboard doanh thu lớn nên dùng materialized view hoặc bảng aggregate ngày/chi nhánh.
- Không hard-delete medical/financial records; dùng trạng thái và audit. Danh mục có thể soft-delete bằng `isActive`.

## 10. Lộ trình migration

1. Tạo bảng mới, chưa xóa cột/JSON cũ.
2. Backend dual-write JSON và bảng chuẩn hóa.
3. Backfill theo batch, kiểm tra checksum/count.
4. Frontend/backend chuyển read sang bảng mới.
5. Thêm constraint NOT NULL/FK sau khi dữ liệu sạch.
6. Ngừng dual-write, giữ JSON legacy một chu kỳ release.
7. Xóa `Appointment.doctorId/branchId`, `Medicine.stockQuantity`, OTP/role fields cũ ở migration cuối.

Không nên thực hiện tất cả trong một migration vì sẽ khóa bảng lâu và khó rollback.
