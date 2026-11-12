BEGIN;

-- Keep existing accounts intact; legacy roles must be reassigned explicitly.
LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "role"::text IN ('pharmacist', 'cashier')
  ) THEN
    RAISE EXCEPTION 'Cannot remove legacy roles: reassign users with pharmacist or cashier roles before applying this migration.';
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'admin',
  'chain_manager',
  'branch_manager',
  'doctor',
  'receptionist',
  'patient'
);

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole"
  USING ("role"::text::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'patient'::"UserRole";

DROP TYPE "UserRole_old";

COMMIT;
