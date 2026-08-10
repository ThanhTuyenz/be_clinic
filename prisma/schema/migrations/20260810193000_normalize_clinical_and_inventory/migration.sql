-- Normalize clinical data that was previously stored only in medical_visits.payload.
-- Legacy JSON and medicines.stock_quantity remain during the dual-write transition.

CREATE TYPE "MedicalVisitStatus" AS ENUM ('DRAFT', 'FINALIZED', 'AMENDED');
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');
CREATE TYPE "ClinicalOrderStatus" AS ENUM ('ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "InventoryMovementType" AS ENUM ('IMPORT', 'DISPENSE', 'ADJUSTMENT', 'RETURN', 'EXPIRED');

ALTER TABLE "medical_visits"
  ADD COLUMN "doctor_id" UUID,
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "status" "MedicalVisitStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "symptoms" TEXT,
  ADD COLUMN "clinical_notes" TEXT,
  ADD COLUMN "treatment_plan" TEXT,
  ADD COLUMN "follow_up_at" TIMESTAMPTZ(3),
  ADD COLUMN "finalized_at" TIMESTAMPTZ(3);

UPDATE "medical_visits" mv
SET
  "doctor_id" = a."doctor_id",
  "branch_id" = a."branch_id",
  "status" = CASE WHEN a."status" = 'COMPLETED' THEN 'FINALIZED'::"MedicalVisitStatus" ELSE 'DRAFT'::"MedicalVisitStatus" END,
  "symptoms" = NULLIF(mv."payload"->>'symptoms', ''),
  "clinical_notes" = NULLIF(COALESCE(mv."payload"->>'clinicalNotes', mv."payload"->>'notes', mv."payload"->>'note'), ''),
  "treatment_plan" = NULLIF(COALESCE(mv."payload"->>'treatmentPlan', mv."payload"->>'treatment'), ''),
  "finalized_at" = CASE WHEN a."status" = 'COMPLETED' THEN mv."updated_at" ELSE NULL END
FROM "appointments" a
WHERE a."id" = mv."appointment_id";

ALTER TABLE "medical_visits"
  ALTER COLUMN "doctor_id" SET NOT NULL,
  ALTER COLUMN "branch_id" SET NOT NULL;

ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_appointment_id_fkey";
ALTER TABLE "medical_visits" ALTER COLUMN "appointment_id" DROP NOT NULL;
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_medical_record_id_fkey";

ALTER TABLE "medical_visits"
  ADD CONSTRAINT "medical_visits_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "medical_visits_medical_record_id_fkey" FOREIGN KEY ("medical_record_id") REFERENCES "medical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "medical_visits_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "medical_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "medical_visits_doctor_id_status_created_at_idx" ON "medical_visits"("doctor_id", "status", "created_at");
CREATE INDEX "medical_visits_branch_id_created_at_idx" ON "medical_visits"("branch_id", "created_at");

CREATE TABLE "visit_vitals" (
  "medical_visit_id" UUID NOT NULL,
  "temperature" DECIMAL(4,1),
  "respiratory_rate" INTEGER,
  "systolic_bp" INTEGER,
  "diastolic_bp" INTEGER,
  "pulse" INTEGER,
  "height_cm" DECIMAL(5,2),
  "weight_kg" DECIMAL(5,2),
  "spo2" DECIMAL(5,2),
  CONSTRAINT "visit_vitals_pkey" PRIMARY KEY ("medical_visit_id"),
  CONSTRAINT "visit_vitals_temperature_check" CHECK ("temperature" IS NULL OR "temperature" BETWEEN 25 AND 50),
  CONSTRAINT "visit_vitals_respiratory_rate_check" CHECK ("respiratory_rate" IS NULL OR "respiratory_rate" BETWEEN 1 AND 100),
  CONSTRAINT "visit_vitals_systolic_bp_check" CHECK ("systolic_bp" IS NULL OR "systolic_bp" BETWEEN 30 AND 300),
  CONSTRAINT "visit_vitals_diastolic_bp_check" CHECK ("diastolic_bp" IS NULL OR "diastolic_bp" BETWEEN 20 AND 200),
  CONSTRAINT "visit_vitals_pulse_check" CHECK ("pulse" IS NULL OR "pulse" BETWEEN 20 AND 300),
  CONSTRAINT "visit_vitals_height_check" CHECK ("height_cm" IS NULL OR "height_cm" BETWEEN 20 AND 300),
  CONSTRAINT "visit_vitals_weight_check" CHECK ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0.1 AND 700),
  CONSTRAINT "visit_vitals_spo2_check" CHECK ("spo2" IS NULL OR "spo2" BETWEEN 0 AND 100),
  CONSTRAINT "visit_vitals_medical_visit_id_fkey" FOREIGN KEY ("medical_visit_id") REFERENCES "medical_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill only values that can be safely converted; malformed legacy values remain in payload.
INSERT INTO "visit_vitals" ("medical_visit_id", "temperature", "respiratory_rate", "systolic_bp", "diastolic_bp", "pulse", "height_cm", "weight_kg", "spo2")
SELECT
  mv."id",
  CASE WHEN COALESCE(mv."payload"->>'temperature', mv."payload"->>'temp') ~ '^[0-9]+([.][0-9]+)?$' THEN COALESCE(mv."payload"->>'temperature', mv."payload"->>'temp')::DECIMAL END,
  CASE WHEN COALESCE(mv."payload"->>'respiratoryRate', mv."payload"->>'breath') ~ '^[0-9]+$' THEN COALESCE(mv."payload"->>'respiratoryRate', mv."payload"->>'breath')::INTEGER END,
  CASE WHEN split_part(COALESCE(mv."payload"->>'bloodPressure', mv."payload"->>'bp'), '/', 1) ~ '^[0-9]+$' THEN split_part(COALESCE(mv."payload"->>'bloodPressure', mv."payload"->>'bp'), '/', 1)::INTEGER END,
  CASE WHEN split_part(COALESCE(mv."payload"->>'bloodPressure', mv."payload"->>'bp'), '/', 2) ~ '^[0-9]+$' THEN split_part(COALESCE(mv."payload"->>'bloodPressure', mv."payload"->>'bp'), '/', 2)::INTEGER END,
  CASE WHEN mv."payload"->>'pulse' ~ '^[0-9]+$' THEN (mv."payload"->>'pulse')::INTEGER END,
  CASE WHEN COALESCE(mv."payload"->>'heightCm', mv."payload"->>'height') ~ '^[0-9]+([.][0-9]+)?$' THEN COALESCE(mv."payload"->>'heightCm', mv."payload"->>'height')::DECIMAL END,
  CASE WHEN COALESCE(mv."payload"->>'weightKg', mv."payload"->>'weight') ~ '^[0-9]+([.][0-9]+)?$' THEN COALESCE(mv."payload"->>'weightKg', mv."payload"->>'weight')::DECIMAL END,
  CASE WHEN mv."payload"->>'spo2' ~ '^[0-9]+([.][0-9]+)?$' THEN (mv."payload"->>'spo2')::DECIMAL END
FROM "medical_visits" mv
WHERE mv."payload" ?| ARRAY['temperature','temp','respiratoryRate','breath','bloodPressure','bp','pulse','heightCm','height','weightKg','weight','spo2'];

CREATE TABLE "visit_diagnoses" (
  "id" BIGSERIAL NOT NULL,
  "medical_visit_id" UUID NOT NULL,
  "icd10_code_id" UUID NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  CONSTRAINT "visit_diagnoses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visit_diagnoses_medical_visit_id_icd10_code_id_key" UNIQUE ("medical_visit_id", "icd10_code_id"),
  CONSTRAINT "visit_diagnoses_medical_visit_id_fkey" FOREIGN KEY ("medical_visit_id") REFERENCES "medical_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "visit_diagnoses_icd10_code_id_fkey" FOREIGN KEY ("icd10_code_id") REFERENCES "icd10_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "visit_diagnoses_icd10_code_id_idx" ON "visit_diagnoses"("icd10_code_id");
CREATE UNIQUE INDEX "visit_diagnoses_one_primary_per_visit_idx" ON "visit_diagnoses"("medical_visit_id") WHERE "is_primary" = true;

INSERT INTO "visit_diagnoses" ("medical_visit_id", "icd10_code_id", "is_primary")
SELECT mv."id", icd."id", true
FROM "medical_visits" mv
JOIN "icd10_codes" icd ON UPPER(icd."code") = UPPER(COALESCE(mv."payload"->>'diagnosisCode', mv."payload"->>'icd10Code'))
ON CONFLICT ("medical_visit_id", "icd10_code_id") DO NOTHING;

CREATE TABLE "prescriptions" (
  "id" UUID NOT NULL,
  "medical_visit_id" UUID NOT NULL,
  "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "issued_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescriptions_medical_visit_id_key" UNIQUE ("medical_visit_id"),
  CONSTRAINT "prescriptions_medical_visit_id_fkey" FOREIGN KEY ("medical_visit_id") REFERENCES "medical_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "prescription_items" (
  "id" BIGSERIAL NOT NULL,
  "prescription_id" UUID NOT NULL,
  "medicine_id" UUID NOT NULL,
  "medicine_name" VARCHAR(255) NOT NULL,
  "strength" VARCHAR(100),
  "unit" VARCHAR(50),
  "quantity" DECIMAL(10,2) NOT NULL,
  "dosage_amount" VARCHAR(100) NOT NULL,
  "frequency_per_day" INTEGER,
  "duration_days" INTEGER,
  "instructions" TEXT,
  CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescription_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "prescription_items_frequency_check" CHECK ("frequency_per_day" IS NULL OR "frequency_per_day" > 0),
  CONSTRAINT "prescription_items_duration_check" CHECK ("duration_days" IS NULL OR "duration_days" > 0),
  CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prescription_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "prescription_items_prescription_id_idx" ON "prescription_items"("prescription_id");
CREATE INDEX "prescription_items_medicine_id_idx" ON "prescription_items"("medicine_id");

CREATE TABLE "clinical_orders" (
  "id" UUID NOT NULL,
  "medical_visit_id" UUID NOT NULL,
  "medical_service_id" UUID NOT NULL,
  "status" "ClinicalOrderStatus" NOT NULL DEFAULT 'ORDERED',
  "service_name" VARCHAR(200) NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "note" TEXT,
  "result_payload" JSONB,
  "ordered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "clinical_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clinical_orders_price_check" CHECK ("price" >= 0),
  CONSTRAINT "clinical_orders_medical_visit_id_fkey" FOREIGN KEY ("medical_visit_id") REFERENCES "medical_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "clinical_orders_medical_service_id_fkey" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "clinical_orders_medical_visit_id_status_idx" ON "clinical_orders"("medical_visit_id", "status");
CREATE INDEX "clinical_orders_medical_service_id_ordered_at_idx" ON "clinical_orders"("medical_service_id", "ordered_at");

CREATE TABLE "inventory_stocks" (
  "branch_id" UUID NOT NULL,
  "medicine_id" UUID NOT NULL,
  "quantity" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("branch_id", "medicine_id"),
  CONSTRAINT "inventory_stocks_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "inventory_stocks_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_stocks_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_movements" (
  "id" BIGSERIAL NOT NULL,
  "branch_id" UUID NOT NULL,
  "medicine_id" UUID NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "quantity" DECIMAL(14,2) NOT NULL,
  "reference_id" VARCHAR(100),
  "note" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_quantity_check" CHECK ("quantity" <> 0),
  CONSTRAINT "inventory_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "inventory_movements_branch_id_medicine_id_created_at_idx" ON "inventory_movements"("branch_id", "medicine_id", "created_at");
CREATE INDEX "inventory_movements_reference_id_idx" ON "inventory_movements"("reference_id");

-- Allocate the legacy global stock to the first active branch once. Future writes use branch stock.
INSERT INTO "inventory_stocks" ("branch_id", "medicine_id", "quantity", "updated_at")
SELECT b."id", m."id", GREATEST(m."stock_quantity", 0), CURRENT_TIMESTAMP
FROM "medicines" m
CROSS JOIN LATERAL (
  SELECT "id" FROM "branches" WHERE "is_active" = true ORDER BY "created_at", "id" LIMIT 1
) b
ON CONFLICT ("branch_id", "medicine_id") DO NOTHING;
