CREATE TABLE "medical_records" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "record_code" VARCHAR(30) NOT NULL,
    "blood_type" VARCHAR(10),
    "allergies" TEXT,
    "chronic_conditions" TEXT,
    "medical_history" TEXT,
    "family_history" TEXT,
    "surgical_history" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medical_records_patient_profile_id_key"
ON "medical_records"("patient_profile_id");

CREATE UNIQUE INDEX "medical_records_record_code_key"
ON "medical_records"("record_code");

ALTER TABLE "medical_records"
ADD CONSTRAINT "medical_records_patient_profile_id_fkey"
FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Một hồ sơ tổng thể cho mỗi hồ sơ bệnh nhân hiện có. Dùng UUID hồ sơ bệnh nhân
-- làm UUID hồ sơ bệnh án để backfill có tính xác định và chạy migration an toàn.
INSERT INTO "medical_records" (
    "id", "patient_profile_id", "record_code", "created_at", "updated_at"
)
SELECT
    pp."id",
    pp."id",
    'MR-' || UPPER(SUBSTRING(REPLACE(pp."id"::text, '-', '') FROM 1 FOR 12)),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "patient_profiles" pp
ON CONFLICT ("patient_profile_id") DO NOTHING;

ALTER TABLE "examinations" ADD COLUMN "medical_record_id" UUID;

UPDATE "examinations" e
SET "medical_record_id" = mr."id"
FROM "appointments" a
JOIN "medical_records" mr ON mr."patient_profile_id" = a."patient_profile_id"
WHERE e."appointment_id" = a."id";

ALTER TABLE "examinations" ALTER COLUMN "medical_record_id" SET NOT NULL;

CREATE INDEX "examinations_medical_record_id_created_at_idx"
ON "examinations"("medical_record_id", "created_at");

ALTER TABLE "examinations"
ADD CONSTRAINT "examinations_medical_record_id_fkey"
FOREIGN KEY ("medical_record_id") REFERENCES "medical_records"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
