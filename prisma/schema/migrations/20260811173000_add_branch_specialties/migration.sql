CREATE TABLE "branch_specialties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "specialty_id" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_specialties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_specialties_branch_id_specialty_id_key"
  ON "branch_specialties"("branch_id", "specialty_id");
CREATE INDEX "branch_specialties_specialty_id_is_active_idx"
  ON "branch_specialties"("specialty_id", "is_active");
CREATE INDEX "branch_specialties_branch_id_is_active_idx"
  ON "branch_specialties"("branch_id", "is_active");

ALTER TABLE "branch_specialties"
  ADD CONSTRAINT "branch_specialties_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_specialties"
  ADD CONSTRAINT "branch_specialties_specialty_id_fkey"
  FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "branch_specialties" ("branch_id", "specialty_id")
SELECT DISTINCT source."branch_id", source."specialty_id"
FROM (
  SELECT bbm."branch_id", ss."specialty_id"
  FROM "specialty_services" ss
  JOIN "branch_booking_methods" bbm ON bbm."id" = ss."branch_booking_method_id"
  WHERE ss."is_active" = true AND bbm."is_enabled" = true
  UNION
  SELECT uba."branch_id", ds."specialty_id"
  FROM "doctor_specialties" ds
  JOIN "doctors" d ON d."id" = ds."doctor_id"
  JOIN "user_branch_assignments" uba ON uba."user_id" = d."user_id"
  WHERE d."is_active" = true
) source
ON CONFLICT ("branch_id", "specialty_id") DO NOTHING;
