BEGIN;

-- Normalize legacy values before narrowing the enum definitions.
UPDATE "appointments"
SET "status" = CASE
  WHEN "status" = 'PENDING_PAYMENT' THEN 'HOLD'
  WHEN "status" = 'BOOKED' THEN 'CONFIRMED'
  WHEN "status" IN ('REFUND_REQUIRED', 'MANUAL_REVIEW') THEN 'CANCELLED'
  ELSE "status"
END;

UPDATE "appointment_status_histories"
SET "from_status" = (CASE "from_status"::text
      WHEN 'PENDING_PAYMENT' THEN 'HOLD'
      WHEN 'BOOKED' THEN 'CONFIRMED'
      WHEN 'REFUND_REQUIRED' THEN 'CANCELLED'
      WHEN 'MANUAL_REVIEW' THEN 'CANCELLED'
      ELSE "from_status"::text
    END)::"AppointmentStatus",
    "to_status" = (CASE "to_status"::text
      WHEN 'PENDING_PAYMENT' THEN 'HOLD'
      WHEN 'BOOKED' THEN 'CONFIRMED'
      WHEN 'REFUND_REQUIRED' THEN 'CANCELLED'
      WHEN 'MANUAL_REVIEW' THEN 'CANCELLED'
      ELSE "to_status"::text
    END)::"AppointmentStatus"
WHERE "from_status"::text IN ('PENDING_PAYMENT', 'BOOKED', 'REFUND_REQUIRED', 'MANUAL_REVIEW')
   OR "to_status"::text IN ('PENDING_PAYMENT', 'BOOKED', 'REFUND_REQUIRED', 'MANUAL_REVIEW');

ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";

CREATE TYPE "AppointmentStatus" AS ENUM (
  'HOLD',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'NO_SHOW'
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

UPDATE "doctor_schedule_slots"
SET "slot_status" = 'AVAILABLE'
WHERE "slot_status" = 'BLOCKED';

ALTER TABLE "doctor_schedule_slots" ALTER COLUMN "slot_status" DROP DEFAULT;

ALTER TYPE "SlotStatus" RENAME TO "SlotStatus_old";

CREATE TYPE "SlotStatus" AS ENUM (
  'AVAILABLE',
  'FULL'
);

ALTER TABLE "doctor_schedule_slots"
  ALTER COLUMN "slot_status" TYPE "SlotStatus"
  USING ("slot_status"::text::"SlotStatus");

ALTER TABLE "doctor_schedule_slots" ALTER COLUMN "slot_status" SET DEFAULT 'AVAILABLE'::"SlotStatus";

DROP TYPE "SlotStatus_old";

UPDATE "booking_orders" AS bo
SET "status" = (CASE
  WHEN EXISTS (
    SELECT 1
    FROM "invoices" AS i
    WHERE i."booking_order_id" = bo."id"
      AND i."status" = 'PAID'
  ) THEN 'PAID'
  ELSE 'UNPAID'
END)::"BookingOrderStatus"
WHERE bo."status" = 'PARTIALLY_CANCELLED';

ALTER TABLE "booking_orders" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "BookingOrderStatus" RENAME TO "BookingOrderStatus_old";

CREATE TYPE "BookingOrderStatus" AS ENUM (
  'UNPAID',
  'PENDING_PAYMENT',
  'PAID',
  'CANCELLED',
  'REFUNDED'
);

ALTER TABLE "booking_orders"
  ALTER COLUMN "status" TYPE "BookingOrderStatus"
  USING ("status"::text::"BookingOrderStatus");

ALTER TABLE "booking_orders" ALTER COLUMN "status" SET DEFAULT 'UNPAID'::"BookingOrderStatus";

DROP TYPE "BookingOrderStatus_old";

COMMIT;
