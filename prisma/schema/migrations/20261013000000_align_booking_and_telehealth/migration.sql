-- Keep the deployed database aligned with the current Prisma schema.
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "booking_method_id" UUID;

CREATE INDEX IF NOT EXISTS "appointments_booking_method_id_idx"
  ON "appointments"("booking_method_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_booking_method_id_fkey'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_booking_method_id_fkey"
      FOREIGN KEY ("booking_method_id") REFERENCES "booking_methods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "telehealth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "appointment_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "duration_seconds" INTEGER NOT NULL DEFAULT 0,
  "diagnosis" TEXT,
  "prescription_notes" TEXT,
  "chat_messages" JSONB,
  "ended_by_user_id" UUID,
  "end_reason" VARCHAR(50),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telehealth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "telehealth_sessions_appointment_id_key" UNIQUE ("appointment_id")
);

ALTER TABLE "telehealth_sessions"
  ADD COLUMN IF NOT EXISTS "ended_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "end_reason" VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'telehealth_sessions_appointment_id_fkey'
  ) THEN
    ALTER TABLE "telehealth_sessions"
      ADD CONSTRAINT "telehealth_sessions_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'telehealth_sessions_ended_by_user_id_fkey'
  ) THEN
    ALTER TABLE "telehealth_sessions"
      ADD CONSTRAINT "telehealth_sessions_ended_by_user_id_fkey"
      FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "telehealth_sessions_ended_by_user_id_idx"
  ON "telehealth_sessions"("ended_by_user_id");
