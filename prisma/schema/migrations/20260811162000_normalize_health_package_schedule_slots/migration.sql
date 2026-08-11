CREATE TABLE "health_package_schedule_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL,
  "start_time" TIME(0) NOT NULL,
  "end_time" TIME(0) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 20,
  "occupied_count" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_package_schedule_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "health_package_schedule_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "health_package_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "health_package_schedule_slots_time_range_check" CHECK ("end_time" > "start_time"),
  CONSTRAINT "health_package_schedule_slots_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "health_package_schedule_slots_occupied_count_check" CHECK ("occupied_count" >= 0 AND "occupied_count" <= "capacity")
);

WITH canonical AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY health_package_id, room_id, exam_date ORDER BY start_time, id) AS canonical_id
  FROM "health_package_schedules"
)
INSERT INTO "health_package_schedule_slots" ("schedule_id", "start_time", "end_time", "capacity", "occupied_count", "is_active", "created_at", "updated_at")
SELECT canonical.canonical_id, schedules.start_time, schedules.end_time, schedules.capacity, schedules.occupied_count, schedules.is_active, schedules.created_at, schedules.updated_at
FROM "health_package_schedules" schedules
JOIN canonical ON canonical.id = schedules.id;

DELETE FROM "health_package_schedules" target
USING "health_package_schedules" keeper
WHERE target.health_package_id = keeper.health_package_id
  AND target.room_id = keeper.room_id
  AND target.exam_date = keeper.exam_date
  AND (target.start_time, target.id) > (keeper.start_time, keeper.id);

DROP INDEX IF EXISTS "health_package_schedules_health_package_id_room_id_exam_date_st";

ALTER TABLE "health_package_schedules"
  DROP COLUMN "start_time",
  DROP COLUMN "end_time",
  DROP COLUMN "capacity",
  DROP COLUMN "occupied_count";

CREATE UNIQUE INDEX "health_package_schedules_health_package_id_room_id_exam_dat_key"
  ON "health_package_schedules"("health_package_id", "room_id", "exam_date");

CREATE UNIQUE INDEX "health_package_schedule_slots_schedule_id_start_time_key"
  ON "health_package_schedule_slots"("schedule_id", "start_time");

CREATE INDEX "health_package_schedule_slots_schedule_id_is_active_idx"
  ON "health_package_schedule_slots"("schedule_id", "is_active");
