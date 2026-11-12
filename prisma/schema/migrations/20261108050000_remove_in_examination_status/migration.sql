BEGIN;

-- The current scope ends at appointment reception; existing examination-state
-- rows are treated as completed before removing the obsolete enum value.
UPDATE "appointments"
SET "status" = 'COMPLETED'
WHERE "status" = 'IN_EXAMINATION';

UPDATE "appointment_status_histories"
SET "from_status" = CASE WHEN "from_status" = 'IN_EXAMINATION' THEN 'COMPLETED' ELSE "from_status" END,
    "to_status" = CASE WHEN "to_status" = 'IN_EXAMINATION' THEN 'COMPLETED' ELSE "to_status" END
WHERE "from_status" = 'IN_EXAMINATION' OR "to_status" = 'IN_EXAMINATION';

ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";

CREATE TYPE "AppointmentStatus" AS ENUM (
  'HOLD',
  'PENDING_PAYMENT',
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'NO_SHOW',
  'REFUND_REQUIRED',
  'MANUAL_REVIEW'
);

ALTER TABLE "appointments"
  ALTER COLUMN "status" TYPE "AppointmentStatus"
  USING ("status"::text::"AppointmentStatus");

ALTER TABLE "appointment_status_histories"
  ALTER COLUMN "from_status" TYPE "AppointmentStatus"
  USING ("from_status"::text::"AppointmentStatus"),
  ALTER COLUMN "to_status" TYPE "AppointmentStatus"
  USING ("to_status"::text::"AppointmentStatus");

ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'HOLD'::"AppointmentStatus";

DROP TYPE "AppointmentStatus_old";

COMMIT;
