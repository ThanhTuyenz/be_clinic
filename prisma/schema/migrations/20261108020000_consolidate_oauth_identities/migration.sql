BEGIN;

-- Lock out concurrent writes while validating ownership and moving identities.
LOCK TABLE "users", "oauth_accounts" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE legacy_oauth_identities ON COMMIT DROP AS
SELECT DISTINCT "user_id", "provider", "provider_account_id", "created_at", "updated_at"
FROM (
  SELECT "id" AS user_id,
    (CASE
      -- Old Zalo signups populated both columns with the same Zalo ID.
      WHEN "provider" = 'zalo' AND
        (NULLIF(btrim("zalo_id"), '') IS NULL OR btrim("zalo_id") = btrim("social_id"))
        THEN 'zalo'
      -- Linking Google to an EMAIL/ZALO user did not update users.provider.
      ELSE 'google'
    END)::"AuthProvider" AS provider,
    btrim("social_id") AS provider_account_id, "created_at", "updated_at"
  FROM "users" WHERE NULLIF(btrim("social_id"), '') IS NOT NULL
  UNION ALL
  SELECT "id", 'zalo'::"AuthProvider", btrim("zalo_id"), "created_at", "updated_at"
  FROM "users" WHERE NULLIF(btrim("zalo_id"), '') IS NOT NULL
) AS legacy;

-- Refuse to silently overwrite ownership or drop conflicting legacy identities.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM legacy_oauth_identities
    GROUP BY "provider", "provider_account_id" HAVING count(DISTINCT "user_id") > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting legacy OAuth identity owners. Resolve duplicate identities before migration.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM legacy_oauth_identities AS legacy
    JOIN "oauth_accounts" AS existing
      ON existing."provider" = legacy."provider"
      AND existing."provider_account_id" = legacy."provider_account_id"
    WHERE existing."user_id" <> legacy."user_id"
  ) THEN
    RAISE EXCEPTION 'Legacy OAuth identity conflicts with oauth_accounts ownership. Resolve before migration.';
  END IF;
END;
$$;

INSERT INTO "oauth_accounts" ("id", "user_id", "provider", "provider_account_id", "created_at", "updated_at")
SELECT gen_random_uuid(), "user_id", "provider", "provider_account_id", "created_at", "updated_at"
FROM legacy_oauth_identities
ON CONFLICT ("provider", "provider_account_id") DO NOTHING;

ALTER TABLE "users" DROP COLUMN "provider", DROP COLUMN "social_id", DROP COLUMN "zalo_id";

COMMIT;
