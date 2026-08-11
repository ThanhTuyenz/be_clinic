ALTER TABLE "appointments"
  ALTER COLUMN "doctor_id" DROP NOT NULL,
  ALTER COLUMN "schedule_slot_id" DROP NOT NULL,
  ADD COLUMN "health_package_id" UUID,
  ADD COLUMN "health_package_schedule_slot_id" UUID;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_health_package_id_fkey"
    FOREIGN KEY ("health_package_id") REFERENCES "health_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_health_package_schedule_slot_id_fkey"
    FOREIGN KEY ("health_package_schedule_slot_id") REFERENCES "health_package_schedule_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "appointments_health_package_id_status_idx"
  ON "appointments"("health_package_id", "status");

CREATE INDEX "appointments_health_package_schedule_slot_id_status_idx"
  ON "appointments"("health_package_schedule_slot_id", "status");
