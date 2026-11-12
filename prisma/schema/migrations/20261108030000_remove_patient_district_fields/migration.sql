BEGIN;

LOCK TABLE "patient_profiles" IN SHARE ROW EXCLUSIVE MODE;

-- Preserve the old location in the free-text address before removing its columns.
WITH legacy_locations AS (
  SELECT "id", COALESCE(NULLIF(btrim("district_name"), ''),
    CASE WHEN NULLIF(btrim("district_code"), '') IS NOT NULL
      THEN 'Mã quận/huyện cũ: ' || btrim("district_code") END) AS location
  FROM "patient_profiles"
)
UPDATE "patient_profiles" AS profile
SET "street_address" = concat_ws(', ', NULLIF(btrim(profile."street_address"), ''), legacy.location)
FROM legacy_locations AS legacy
WHERE profile."id" = legacy."id" AND legacy.location IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM regexp_split_to_table(COALESCE(profile."street_address", ''), '\s*,\s*') AS part
    WHERE lower(btrim(part)) = lower(legacy.location)
  );

ALTER TABLE "patient_profiles" DROP COLUMN "district_code", DROP COLUMN "district_name";

COMMIT;
