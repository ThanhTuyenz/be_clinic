CREATE TABLE "branch_specialty_schedules" (
  "id" UUID NOT NULL,
  "branch_specialty_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "branch_specialty_schedules_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "branch_specialty_schedule_slots" (
  "id" UUID NOT NULL,
  "schedule_id" UUID NOT NULL,
  "start_time" TIME(0) NOT NULL,
  "end_time" TIME(0) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 20,
  "occupied_count" INTEGER NOT NULL DEFAULT 0,
  "next_queue_number" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "branch_specialty_schedule_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_specialty_schedule_slots_time_check" CHECK ("end_time" > "start_time"),
  CONSTRAINT "branch_specialty_schedule_slots_capacity_check" CHECK ("capacity" > 0 AND "occupied_count" >= 0 AND "occupied_count" <= "capacity")
);
ALTER TABLE "appointments" ADD COLUMN "branch_specialty_schedule_slot_id" UUID;
CREATE UNIQUE INDEX "branch_specialty_schedules_branch_specialty_id_work_date_key" ON "branch_specialty_schedules"("branch_specialty_id", "work_date");
CREATE INDEX "branch_specialty_schedules_work_date_is_active_idx" ON "branch_specialty_schedules"("work_date", "is_active");
CREATE UNIQUE INDEX "branch_specialty_schedule_slots_schedule_id_start_time_key" ON "branch_specialty_schedule_slots"("schedule_id", "start_time");
CREATE INDEX "branch_specialty_schedule_slots_schedule_id_is_active_idx" ON "branch_specialty_schedule_slots"("schedule_id", "is_active");
CREATE INDEX "appointments_branch_specialty_schedule_slot_id_status_idx" ON "appointments"("branch_specialty_schedule_slot_id", "status");
ALTER TABLE "branch_specialty_schedules" ADD CONSTRAINT "branch_specialty_schedules_branch_specialty_id_fkey" FOREIGN KEY ("branch_specialty_id") REFERENCES "branch_specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_specialty_schedule_slots" ADD CONSTRAINT "branch_specialty_schedule_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "branch_specialty_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_specialty_schedule_slot_id_fkey" FOREIGN KEY ("branch_specialty_schedule_slot_id") REFERENCES "branch_specialty_schedule_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
