CREATE TABLE "service_packages" (
  "id" UUID NOT NULL,
  "branch_booking_method_id" UUID NOT NULL,
  "specialty_id" INTEGER,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "duration_min" INTEGER NOT NULL DEFAULT 30,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

INSERT INTO "service_packages" ("id", "branch_booking_method_id", "specialty_id", "code", "name", "description", "price", "duration_min", "is_active", "created_at", "updated_at")
SELECT "id", "branch_booking_method_id", "specialty_id", "code", "name", "description", "price", "duration_min", "is_active", "created_at", "updated_at"
FROM "specialty_services";

INSERT INTO "service_packages" ("id", "branch_booking_method_id", "specialty_id", "code", "name", "description", "price", "duration_min", "is_active", "created_at", "updated_at")
SELECT hp."id", hp."branch_booking_method_id", NULL,
       CASE WHEN EXISTS (SELECT 1 FROM "service_packages" sp WHERE sp."code" = hp."code") THEN LEFT('HP-' || hp."code", 50) ELSE hp."code" END,
       hp."name", hp."description", hp."price", 30, hp."is_active", hp."created_at", hp."updated_at"
FROM "health_packages" hp;

CREATE UNIQUE INDEX "service_packages_code_key" ON "service_packages"("code");
CREATE INDEX "service_packages_branch_booking_method_id_specialty_id_is_a_idx" ON "service_packages"("branch_booking_method_id", "specialty_id", "is_active");

CREATE TABLE "service_package_schedules" (
  "id" UUID NOT NULL,
  "service_package_id" UUID NOT NULL,
  "room_id" UUID,
  "exam_date" DATE NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "service_package_schedules_pkey" PRIMARY KEY ("id")
);

INSERT INTO "service_package_schedules" ("id", "service_package_id", "room_id", "exam_date", "is_active", "created_at", "updated_at")
SELECT "id", "health_package_id", "room_id", "exam_date", "is_active", "created_at", "updated_at"
FROM "health_package_schedules";

INSERT INTO "service_package_schedules" ("id", "service_package_id", "room_id", "exam_date", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), sp."id", NULL, bss."work_date", bss."is_active", bss."created_at", bss."updated_at"
FROM "service_packages" sp
JOIN "branch_booking_methods" bbm ON bbm."id" = sp."branch_booking_method_id"
JOIN "branch_specialties" bs ON bs."branch_id" = bbm."branch_id" AND bs."specialty_id" = sp."specialty_id"
JOIN "branch_specialty_schedules" bss ON bss."branch_specialty_id" = bs."id";

CREATE INDEX "service_package_schedules_exam_date_is_active_idx" ON "service_package_schedules"("exam_date", "is_active");
CREATE UNIQUE INDEX "service_package_schedules_service_package_id_exam_date_key" ON "service_package_schedules"("service_package_id", "exam_date");

CREATE TABLE "service_package_schedule_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL,
  "start_time" TIME(0) NOT NULL,
  "end_time" TIME(0) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 20,
  "occupied_count" INTEGER NOT NULL DEFAULT 0,
  "next_queue_number" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_package_schedule_slots_pkey" PRIMARY KEY ("id")
);

INSERT INTO "service_package_schedule_slots" ("id", "schedule_id", "start_time", "end_time", "capacity", "occupied_count", "next_queue_number", "is_active", "created_at", "updated_at")
SELECT "id", "schedule_id", "start_time", "end_time", "capacity", "occupied_count", "next_queue_number", "is_active", "created_at", "updated_at"
FROM "health_package_schedule_slots";

INSERT INTO "service_package_schedule_slots" ("schedule_id", "start_time", "end_time", "capacity", "occupied_count", "next_queue_number", "is_active", "created_at", "updated_at")
SELECT sps."id", bslot."start_time", bslot."end_time", bslot."capacity", bslot."occupied_count", bslot."next_queue_number", bslot."is_active", bslot."created_at", bslot."updated_at"
FROM "service_package_schedules" sps
JOIN "service_packages" sp ON sp."id" = sps."service_package_id" AND sp."specialty_id" IS NOT NULL
JOIN "branch_booking_methods" bbm ON bbm."id" = sp."branch_booking_method_id"
JOIN "branch_specialties" bs ON bs."branch_id" = bbm."branch_id" AND bs."specialty_id" = sp."specialty_id"
JOIN "branch_specialty_schedules" bss ON bss."branch_specialty_id" = bs."id" AND bss."work_date" = sps."exam_date"
JOIN "branch_specialty_schedule_slots" bslot ON bslot."schedule_id" = bss."id";

CREATE INDEX "service_package_schedule_slots_schedule_id_is_active_idx" ON "service_package_schedule_slots"("schedule_id", "is_active");
CREATE UNIQUE INDEX "service_package_schedule_slots_schedule_id_start_time_key" ON "service_package_schedule_slots"("schedule_id", "start_time");

CREATE TABLE "service_package_items" (
  "service_package_id" UUID NOT NULL,
  "medical_service_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "service_package_items_pkey" PRIMARY KEY ("service_package_id", "medical_service_id")
);
INSERT INTO "service_package_items" SELECT "health_package_id", "medical_service_id", "quantity", "sort_order" FROM "health_package_items";
CREATE INDEX "service_package_items_medical_service_id_idx" ON "service_package_items"("medical_service_id");

ALTER TABLE "appointments" ADD COLUMN "service_package_id" UUID;
ALTER TABLE "appointments" ADD COLUMN "service_package_schedule_slot_id" UUID;
UPDATE "appointments" SET "service_package_id" = COALESCE("specialty_service_id", "health_package_id");
UPDATE "appointments" SET "service_package_schedule_slot_id" = "health_package_schedule_slot_id" WHERE "health_package_schedule_slot_id" IS NOT NULL;
UPDATE "appointments" a
SET "service_package_schedule_slot_id" = spslot."id"
FROM "branch_specialty_schedule_slots" oldslot
JOIN "branch_specialty_schedules" olds ON olds."id" = oldslot."schedule_id"
JOIN "service_package_schedules" sps ON sps."exam_date" = olds."work_date"
JOIN "service_package_schedule_slots" spslot ON spslot."schedule_id" = sps."id" AND spslot."start_time" = oldslot."start_time"
WHERE a."branch_specialty_schedule_slot_id" = oldslot."id" AND sps."service_package_id" = a."specialty_service_id";

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_branch_specialty_schedule_slot_id_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_health_package_id_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_health_package_schedule_slot_id_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_specialty_service_id_fkey";
DROP INDEX IF EXISTS "appointments_branch_specialty_schedule_slot_id_status_idx";
DROP INDEX IF EXISTS "appointments_health_package_id_status_idx";
DROP INDEX IF EXISTS "appointments_health_package_schedule_slot_id_status_idx";
DROP INDEX IF EXISTS "appointments_specialty_service_id_status_idx";
ALTER TABLE "appointments" DROP COLUMN "branch_specialty_schedule_slot_id", DROP COLUMN "health_package_id", DROP COLUMN "health_package_schedule_slot_id", DROP COLUMN "specialty_service_id";
CREATE INDEX "appointments_service_package_id_status_idx" ON "appointments"("service_package_id", "status");
CREATE INDEX "appointments_service_package_schedule_slot_id_status_idx" ON "appointments"("service_package_schedule_slot_id", "status");

ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_branch_booking_method_id_fkey" FOREIGN KEY ("branch_booking_method_id") REFERENCES "branch_booking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_package_schedules" ADD CONSTRAINT "service_package_schedules_service_package_id_fkey" FOREIGN KEY ("service_package_id") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_package_schedules" ADD CONSTRAINT "service_package_schedules_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "clinic_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_package_schedule_slots" ADD CONSTRAINT "service_package_schedule_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "service_package_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_service_package_id_fkey" FOREIGN KEY ("service_package_id") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_medical_service_id_fkey" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_package_id_fkey" FOREIGN KEY ("service_package_id") REFERENCES "service_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_package_schedule_slot_id_fkey" FOREIGN KEY ("service_package_schedule_slot_id") REFERENCES "service_package_schedule_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "branch_specialty_schedule_slots";
DROP TABLE "branch_specialty_schedules";
DROP TABLE "health_package_items";
DROP TABLE "health_package_schedule_slots";
DROP TABLE "health_package_schedules";
DROP TABLE "health_packages";
DROP TABLE "specialty_services";
