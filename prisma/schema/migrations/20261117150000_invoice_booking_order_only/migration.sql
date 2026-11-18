BEGIN;

LOCK TABLE "appointments", "booking_orders", "invoices", "voucher_usages" IN SHARE ROW EXCLUSIVE MODE;

-- Reuse an invoice's existing order before creating orders for legacy singles.
UPDATE "appointments" a
SET "booking_order_id" = i."booking_order_id"
FROM "invoices" i
WHERE i."appointment_id" = a."id"
  AND a."booking_order_id" IS NULL AND i."booking_order_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "invoices" i JOIN "appointments" a ON a."id" = i."appointment_id"
    WHERE i."booking_order_id" IS NOT NULL AND a."booking_order_id" IS NOT NULL
      AND i."booking_order_id" <> a."booking_order_id"
  ) THEN
    RAISE EXCEPTION 'Invoice and appointment refer to different booking orders. Resolve ownership before migration.';
  END IF;
END $$;

CREATE TEMP TABLE "single_order_backfill" ON COMMIT DROP AS
SELECT "id" AS "appointment_id", gen_random_uuid() AS "booking_order_id"
FROM "appointments" WHERE "booking_order_id" IS NULL;

INSERT INTO "booking_orders" (
  "id", "account_id", "order_code", "group_type", "status", "total_amount", "created_at", "updated_at"
)
SELECT m."booking_order_id", p."account_id",
  'ORD-MIG-' || upper(substr(replace(m."booking_order_id"::text, '-', ''), 1, 22)),
  'SINGLE',
  (CASE WHEN i."status"::text = 'PAID' THEN 'PAID'
    WHEN i."status"::text = 'REFUNDED' THEN 'REFUNDED'
    WHEN i."status"::text = 'CANCELLED' OR a."status"::text IN ('CANCELLED', 'EXPIRED') THEN 'CANCELLED'
    ELSE 'UNPAID' END)::"BookingOrderStatus",
  COALESCE(i."total_amount", a."service_price"), a."created_at", NOW()
FROM "single_order_backfill" m
JOIN "appointments" a ON a."id" = m."appointment_id"
JOIN "patient_profiles" p ON p."id" = a."patient_profile_id"
LEFT JOIN "invoices" i ON i."appointment_id" = a."id";

UPDATE "appointments" a SET "booking_order_id" = m."booking_order_id"
FROM "single_order_backfill" m WHERE a."id" = m."appointment_id";

UPDATE "invoices" i SET "booking_order_id" = a."booking_order_id"
FROM "appointments" a WHERE i."appointment_id" = a."id" AND i."booking_order_id" IS NULL;

UPDATE "voucher_usages" v SET "booking_order_id" = a."booking_order_id"
FROM "appointments" a WHERE v."appointment_id" = a."id" AND v."booking_order_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "invoices" WHERE "booking_order_id" IS NULL)
     OR EXISTS (SELECT 1 FROM "appointments" WHERE "booking_order_id" IS NULL) THEN
    RAISE EXCEPTION 'A legacy record has no resolvable booking order. No data was removed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "appointments" a
    JOIN "patient_profiles" p ON p."id" = a."patient_profile_id"
    JOIN "booking_orders" o ON o."id" = a."booking_order_id"
    WHERE p."account_id" <> o."account_id"
  ) THEN
    RAISE EXCEPTION 'Appointment owner differs from booking order owner. No data was removed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "invoices" i JOIN "appointments" a ON a."booking_order_id" = i."booking_order_id"
    WHERE i."issued_branch_id" <> a."branch_id"
  ) THEN
    RAISE EXCEPTION 'Invoice and order members belong to different branches. No data was removed.';
  END IF;
END $$;

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_booking_order_id_fkey";
ALTER TABLE "appointments" ALTER COLUMN "booking_order_id" SET NOT NULL;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_order_id_fkey"
  FOREIGN KEY ("booking_order_id") REFERENCES "booking_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invoice IDs, amounts, statuses, payment references and refund JSON stay intact.
ALTER TABLE "invoices" ALTER COLUMN "booking_order_id" SET NOT NULL;
ALTER TABLE "invoices" DROP COLUMN "appointment_id";

COMMIT;
