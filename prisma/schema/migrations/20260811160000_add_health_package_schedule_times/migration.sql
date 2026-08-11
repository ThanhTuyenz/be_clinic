ALTER TABLE "health_package_schedules"
  ADD COLUMN "start_time" TIME(0) NOT NULL DEFAULT TIME '08:00:00',
  ADD COLUMN "end_time" TIME(0) NOT NULL DEFAULT TIME '11:30:00',
  ADD COLUMN "occupied_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "health_package_schedules"
  DROP CONSTRAINT IF EXISTS "health_package_schedules_health_package_id_room_id_exam_date_key";

DROP INDEX IF EXISTS "health_package_schedules_health_package_id_room_id_exam_date_key";

CREATE UNIQUE INDEX "health_package_schedules_health_package_id_room_id_exam_date_start_time_key"
  ON "health_package_schedules"("health_package_id", "room_id", "exam_date", "start_time");

ALTER TABLE "health_package_schedules"
  ADD CONSTRAINT "health_package_schedules_time_range_check" CHECK ("end_time" > "start_time"),
  ADD CONSTRAINT "health_package_schedules_occupied_count_check" CHECK ("occupied_count" >= 0 AND "occupied_count" <= "capacity");
