BEGIN;

-- This migration targets the current integer catalog IDs in schema/*.prisma.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'booking_methods' AND column_name = 'id') <> 'integer' THEN
    RAISE EXCEPTION 'Catalog IDs must use the current integer schema before this migration can run';
  END IF;
END $$;

LOCK TABLE "service_packages", "branch_booking_methods", "service_package_branch_booking_methods" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "service_packages" ADD COLUMN "booking_method_id" INTEGER;
CREATE TABLE "service_package_branches" (
  "id" SERIAL NOT NULL,
  "service_package_id" INTEGER NOT NULL,
  "branch_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_package_branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_package_branches_service_package_id_fkey" FOREIGN KEY ("service_package_id") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_package_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "service_package_branches_service_package_id_branch_id_key" ON "service_package_branches"("service_package_id", "branch_id");
CREATE INDEX "service_package_branches_branch_id_idx" ON "service_package_branches"("branch_id");

-- Preserve branches from both old representations, deduplicated per package.
INSERT INTO "service_package_branches" ("service_package_id", "branch_id", "created_at")
SELECT "service_package_id", "branch_id", MIN("created_at") FROM (
  SELECT p."id" AS "service_package_id", m."branch_id", p."created_at"
  FROM "service_packages" p JOIN "branch_booking_methods" m ON m."id" = p."branch_booking_method_id"
  UNION ALL
  SELECT l."service_package_id", m."branch_id", l."created_at"
  FROM "service_package_branch_booking_methods" l JOIN "branch_booking_methods" m ON m."id" = l."branch_booking_method_id"
) old_deployments GROUP BY "service_package_id", "branch_id";

INSERT INTO "booking_methods" ("code", "name", "description", "is_active", "updated_at")
SELECT 'HEALTH_PACKAGE', 'Khám theo gói', 'Đặt khám theo gói khám', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "booking_methods" WHERE "code" = 'HEALTH_PACKAGE');

-- Deterministic choice authorized by the owner: primary, lowest linked ID,
-- then HEALTH_PACKAGE for a package with no valid previous method.
UPDATE "service_packages" p SET "booking_method_id" = COALESCE(
  (SELECT m."booking_method_id" FROM "branch_booking_methods" m
   JOIN "booking_methods" bm ON bm."id" = m."booking_method_id"
   WHERE m."id" = p."branch_booking_method_id" AND bm."code" IN ('SPECIALTY_EXAM', 'AFTER_HOURS', 'HEALTH_PACKAGE')),
  (SELECT MIN(m."booking_method_id") FROM "service_package_branch_booking_methods" l
   JOIN "branch_booking_methods" m ON m."id" = l."branch_booking_method_id"
   JOIN "booking_methods" bm ON bm."id" = m."booking_method_id"
   WHERE l."service_package_id" = p."id" AND bm."code" IN ('SPECIALTY_EXAM', 'AFTER_HOURS', 'HEALTH_PACKAGE')),
  (SELECT "id" FROM "booking_methods" WHERE "code" = 'HEALTH_PACKAGE')
);

-- Keep branch enable/disable settings. Newly needed channels start disabled.
INSERT INTO "branch_booking_methods" ("branch_id", "booking_method_id", "is_enabled", "updated_at")
SELECT DISTINCT l."branch_id", p."booking_method_id", false, CURRENT_TIMESTAMP
FROM "service_package_branches" l JOIN "service_packages" p ON p."id" = l."service_package_id"
ON CONFLICT ("branch_id", "booking_method_id") DO NOTHING;

ALTER TABLE "service_packages" ALTER COLUMN "booking_method_id" SET NOT NULL;
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_booking_method_id_fkey" FOREIGN KEY ("booking_method_id") REFERENCES "booking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "service_packages_booking_method_id_specialty_id_is_active_idx" ON "service_packages"("booking_method_id", "specialty_id", "is_active");

DROP TABLE "service_package_branch_booking_methods";
ALTER TABLE "service_packages" DROP COLUMN "branch_booking_method_id";
-- Historical Appointment.booking_method_id and service_price are unchanged.
COMMIT;
