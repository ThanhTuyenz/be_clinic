ALTER TABLE "health_package_schedule_slots"
  ADD COLUMN "next_queue_number" INTEGER NOT NULL DEFAULT 0;
