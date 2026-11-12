BEGIN;

-- is_blocked remains the authoritative blocked state.
ALTER TABLE "users" DROP COLUMN "blocked_at";

-- Preserve legacy free-text addresses without truncating them to VARCHAR(255).
ALTER TABLE "patient_profiles" ALTER COLUMN "street_address" TYPE TEXT;
WITH legacy_addresses AS (
  SELECT "id", btrim("address") AS full_address,
    concat_ws(', ', NULLIF(btrim("ward_name"), ''),
      NULLIF(btrim("district_name"), ''), NULLIF(btrim("province_name"), '')) AS suffix
  FROM "patient_profiles"
  WHERE NULLIF(btrim("street_address"), '') IS NULL
    AND NULLIF(btrim("address"), '') IS NOT NULL
)
UPDATE "patient_profiles" AS profile
SET "street_address" = CASE
  WHEN legacy.full_address = legacy.suffix THEN NULL
  WHEN legacy.suffix <> '' AND right(legacy.full_address, length(legacy.suffix) + 2) = ', ' || legacy.suffix
    THEN NULLIF(btrim(left(legacy.full_address, length(legacy.full_address) - length(legacy.suffix) - 2)), '')
  ELSE legacy.full_address
END
FROM legacy_addresses AS legacy WHERE profile."id" = legacy."id";
ALTER TABLE "patient_profiles" DROP COLUMN "address";

-- Review is outside the product scope; these values were seeded, not collected.
ALTER TABLE "doctors" DROP COLUMN "rating_average", DROP COLUMN "rating_count";

-- Queue numbers are computed from appointments; this counter is not consumed.
ALTER TABLE "doctor_schedule_slots" DROP COLUMN "next_queue_number";

COMMIT;
