-- Add structured eligibility metadata for recommendation safety.
CREATE TYPE "PackageGenderTarget" AS ENUM ('ALL', 'MALE', 'FEMALE');

ALTER TABLE "service_packages"
  ADD COLUMN "target_gender" "PackageGenderTarget" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "min_age" INTEGER,
  ADD COLUMN "max_age" INTEGER,
  ADD COLUMN "is_pediatric" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_follow_up" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "follow_up_after_days" INTEGER;

UPDATE "service_packages"
SET
  "target_gender" = CASE
    WHEN lower("name" || ' ' || coalesce("description", '')) ~ '(phụ khoa|thai sản|cổ tử cung|buồng trứng|mang thai|khám thai|sinh sản nữ|nữ giới)'
      THEN 'FEMALE'::"PackageGenderTarget"
    WHEN lower("name" || ' ' || coalesce("description", '')) ~ '(nam khoa|tuyến tiền liệt|sinh sản nam|sức khỏe nam giới|nam giới)'
      THEN 'MALE'::"PackageGenderTarget"
    ELSE 'ALL'::"PackageGenderTarget"
  END,
  "is_pediatric" = lower("name" || ' ' || coalesce("description", '')) ~ '(nhi khoa|sơ sinh|trẻ em|tiêm chủng trẻ em)',
  "is_follow_up" = ("code" ILIKE '%-FOLLOWUP%' OR lower("name") LIKE '%tái khám%'),
  "follow_up_after_days" = CASE
    WHEN ("code" ILIKE '%-FOLLOWUP%' OR lower("name") LIKE '%tái khám%') THEN 180
    ELSE NULL
  END;
