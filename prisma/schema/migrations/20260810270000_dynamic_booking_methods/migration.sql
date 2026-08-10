-- Convert the fixed enum into a dynamic catalog while preserving existing data.
CREATE TABLE "booking_methods" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "route" VARCHAR(255),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "booking_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_methods_code_key" ON "booking_methods"("code");
CREATE INDEX "booking_methods_is_active_name_idx" ON "booking_methods"("is_active", "name");

INSERT INTO "booking_methods" ("id", "code", "name", "description", "route", "updated_at") VALUES
  ('b0000000-0000-4000-8000-000000000001', 'SPECIALTY_EXAM', 'Đặt khám theo chuyên khoa', 'Chọn chuyên khoa, dịch vụ, bác sĩ và thời gian khám.', '/dat-lich?type=specialty', CURRENT_TIMESTAMP),
  ('b0000000-0000-4000-8000-000000000002', 'HEALTH_PACKAGE', 'Gói khám sức khỏe', 'Đăng ký gói khám sức khỏe theo lịch của cơ sở.', '/dich-vu?view=health-packages', CURRENT_TIMESTAMP),
  ('b0000000-0000-4000-8000-000000000003', 'CONSULTATION', 'Tư vấn khám bệnh', 'Tư vấn ban đầu với bác sĩ trước khi đặt lịch khám.', '/dat-lich?type=consultation', CURRENT_TIMESTAMP),
  ('b0000000-0000-4000-8000-000000000004', 'AFTER_HOURS', 'Đặt khám ngoài giờ', 'Đặt lịch khám ngoài khung giờ hành chính.', '/dat-lich?type=after-hours', CURRENT_TIMESTAMP);

ALTER TABLE "branch_booking_methods" ADD COLUMN "booking_method_id" UUID;
UPDATE "branch_booking_methods" bbm
SET "booking_method_id" = bm."id"
FROM "booking_methods" bm
WHERE bm."code" = bbm."type"::text;
ALTER TABLE "branch_booking_methods" ALTER COLUMN "booking_method_id" SET NOT NULL;

ALTER TABLE "specialty_services" ADD COLUMN "branch_booking_method_id" UUID;
UPDATE "specialty_services" ss
SET "branch_booking_method_id" = bbm."id"
FROM "branch_booking_methods" bbm
JOIN "booking_methods" bm ON bm."id" = bbm."booking_method_id"
WHERE bbm."branch_id" = ss."branch_id"
  AND bm."code" = CASE
    WHEN ss."code" LIKE '%-AFTER' THEN 'AFTER_HOURS'
    WHEN ss."code" LIKE '%-ADVICE' THEN 'CONSULTATION'
    ELSE 'SPECIALTY_EXAM'
  END;
ALTER TABLE "specialty_services" ALTER COLUMN "branch_booking_method_id" SET NOT NULL;

ALTER TABLE "health_packages" ADD COLUMN "branch_booking_method_id" UUID;
UPDATE "health_packages" hp
SET "branch_booking_method_id" = bbm."id"
FROM "branch_booking_methods" bbm
JOIN "booking_methods" bm ON bm."id" = bbm."booking_method_id" AND bm."code" = 'HEALTH_PACKAGE'
WHERE bbm."branch_id" = hp."branch_id";
ALTER TABLE "health_packages" ALTER COLUMN "branch_booking_method_id" SET NOT NULL;

DROP INDEX "branch_booking_methods_branch_id_type_key";
ALTER TABLE "branch_booking_methods" DROP COLUMN "type", DROP COLUMN "display_name", DROP COLUMN "description";
CREATE UNIQUE INDEX "branch_booking_methods_branch_id_booking_method_id_key" ON "branch_booking_methods"("branch_id", "booking_method_id");
CREATE INDEX "branch_booking_methods_booking_method_id_idx" ON "branch_booking_methods"("booking_method_id");
ALTER TABLE "branch_booking_methods" ADD CONSTRAINT "branch_booking_methods_booking_method_id_fkey" FOREIGN KEY ("booking_method_id") REFERENCES "booking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "specialty_services" DROP CONSTRAINT "specialty_services_branch_id_fkey";
DROP INDEX "specialty_services_branch_id_specialty_id_name_key";
DROP INDEX "specialty_services_branch_id_specialty_id_is_active_idx";
ALTER TABLE "specialty_services" DROP COLUMN "branch_id";
CREATE UNIQUE INDEX "specialty_services_branch_booking_method_id_specialty_id_name_key" ON "specialty_services"("branch_booking_method_id", "specialty_id", "name");
CREATE INDEX "specialty_services_branch_booking_method_id_specialty_id_is_active_idx" ON "specialty_services"("branch_booking_method_id", "specialty_id", "is_active");
ALTER TABLE "specialty_services" ADD CONSTRAINT "specialty_services_branch_booking_method_id_fkey" FOREIGN KEY ("branch_booking_method_id") REFERENCES "branch_booking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "health_packages" DROP CONSTRAINT "health_packages_branch_id_fkey";
DROP INDEX "health_packages_branch_id_code_key";
DROP INDEX "health_packages_branch_id_is_active_name_idx";
ALTER TABLE "health_packages" DROP COLUMN "branch_id";
CREATE UNIQUE INDEX "health_packages_branch_booking_method_id_code_key" ON "health_packages"("branch_booking_method_id", "code");
CREATE INDEX "health_packages_branch_booking_method_id_is_active_name_idx" ON "health_packages"("branch_booking_method_id", "is_active", "name");
ALTER TABLE "health_packages" ADD CONSTRAINT "health_packages_branch_booking_method_id_fkey" FOREIGN KEY ("branch_booking_method_id") REFERENCES "branch_booking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "BookingMethodType";
