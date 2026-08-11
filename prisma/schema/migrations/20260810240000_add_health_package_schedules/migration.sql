CREATE TABLE "health_package_schedules" (
  "id" UUID NOT NULL,
  "health_package_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "exam_date" DATE NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 20,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "health_package_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_package_schedules_health_package_id_room_id_exam_date_key" ON "health_package_schedules"("health_package_id", "room_id", "exam_date");
CREATE INDEX "health_package_schedules_exam_date_is_active_idx" ON "health_package_schedules"("exam_date", "is_active");
ALTER TABLE "health_package_schedules" ADD CONSTRAINT "health_package_schedules_health_package_id_fkey" FOREIGN KEY ("health_package_id") REFERENCES "health_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_package_schedules" ADD CONSTRAINT "health_package_schedules_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "clinic_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "health_package_schedules" ADD CONSTRAINT "health_package_schedules_capacity_check" CHECK ("capacity" > 0);
