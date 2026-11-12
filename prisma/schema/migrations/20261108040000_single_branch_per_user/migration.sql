BEGIN;

ALTER TABLE "users"
  ADD COLUMN "branch_id" UUID;

-- Keep the primary assignment when present; otherwise keep the most recent one.
WITH chosen_branch AS (
  SELECT DISTINCT ON ("user_id")
    "user_id",
    "branch_id"
  FROM "user_branch_assignments"
  ORDER BY "user_id", "is_primary" DESC, "created_at" DESC, "id" DESC
)
UPDATE "users" AS u
SET "branch_id" = chosen_branch."branch_id"
FROM chosen_branch
WHERE u."id" = chosen_branch."user_id";

ALTER TABLE "users"
  ADD CONSTRAINT "users_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");

DROP TABLE "user_branch_assignments";

COMMIT;
