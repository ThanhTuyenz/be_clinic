BEGIN;

CREATE TYPE "PackageSession" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- This relation exists in the Prisma schema but was missing from migration history.
CREATE TABLE IF NOT EXISTS "service_package_branch_booking_methods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "service_package_id" UUID NOT NULL REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "branch_booking_method_id" UUID NOT NULL REFERENCES "branch_booking_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_package_branch_booking_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_package_branch_booking_methods_service_package_id_bra_key"
  ON "service_package_branch_booking_methods"("service_package_id", "branch_booking_method_id");
CREATE INDEX IF NOT EXISTS "service_package_branch_booking_methods_branch_booking_method_idx"
  ON "service_package_branch_booking_methods"("branch_booking_method_id");

INSERT INTO "service_package_branch_booking_methods" ("id", "service_package_id", "branch_booking_method_id")
SELECT gen_random_uuid(), "id", "branch_booking_method_id" FROM "service_packages" WHERE "branch_booking_method_id" IS NOT NULL
ON CONFLICT ("service_package_id", "branch_booking_method_id") DO NOTHING;

CREATE TABLE "package_reception_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "service_package_id" UUID NOT NULL REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "day_of_week" INTEGER NOT NULL CHECK ("day_of_week" BETWEEN 0 AND 6),
  "sessions" "PackageSession"[] NOT NULL CHECK (cardinality("sessions") > 0 AND array_position("sessions", NULL) IS NULL),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_reception_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "package_reception_schedules_service_package_id_branch_id_day_key"
  ON "package_reception_schedules"("service_package_id", "branch_id", "day_of_week");
CREATE INDEX "package_reception_schedules_branch_id_service_package_id_idx"
  ON "package_reception_schedules"("branch_id", "service_package_id");

-- JSON access also supports databases created before the old schedule columns existed.
INSERT INTO "package_reception_schedules" ("service_package_id", "branch_id", "day_of_week", "sessions")
SELECT DISTINCT p."id", bbm."branch_id", days.value::INTEGER,
  CASE COALESCE(to_jsonb(p)->>'session_type', 'ALL_DAY')
    WHEN 'MORNING' THEN ARRAY['MORNING']
    WHEN 'AFTERNOON' THEN ARRAY['AFTERNOON']
    WHEN 'EVENING' THEN ARRAY['EVENING']
    WHEN 'OFFICE_HOURS' THEN ARRAY['MORNING', 'AFTERNOON']
    ELSE ARRAY['MORNING', 'AFTERNOON', 'EVENING']
  END::"PackageSession"[]
FROM "service_packages" p
JOIN "service_package_branch_booking_methods" links ON links."service_package_id" = p."id"
JOIN "branch_booking_methods" bbm ON bbm."id" = links."branch_booking_method_id"
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_array_length(COALESCE(to_jsonb(p)->'active_days_of_week', '[]'::jsonb)) > 0
    THEN to_jsonb(p)->'active_days_of_week' ELSE '[0,1,2,3,4,5,6]'::jsonb END
) days(value);

ALTER TABLE "service_packages" DROP COLUMN IF EXISTS "session_type", DROP COLUMN IF EXISTS "active_days_of_week";

COMMIT;
