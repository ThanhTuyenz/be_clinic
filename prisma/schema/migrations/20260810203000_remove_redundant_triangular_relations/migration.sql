-- 1. Unify every employee's branch scope in user_branch_assignments.
INSERT INTO "user_branch_assignments" (
  "id", "user_id", "branch_id", "is_primary", "created_at"
)
SELECT
  dba."id", d."user_id", dba."branch_id", dba."is_primary", dba."created_at"
FROM "doctor_branch_assignments" dba
JOIN "doctors" d ON d."id" = dba."doctor_id"
ON CONFLICT ("user_id", "branch_id") DO UPDATE
SET "is_primary" = EXCLUDED."is_primary" OR "user_branch_assignments"."is_primary";

DROP TABLE "doctor_branch_assignments";

-- 2. An invoice derives its patient from its required appointment. Keep only
-- the issuing branch because that is an accounting/reporting dimension.
DROP INDEX IF EXISTS "invoices_branch_id_status_created_at_idx";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_patient_profile_id_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_branch_id_fkey";
ALTER TABLE "invoices" DROP COLUMN "patient_profile_id";
ALTER TABLE "invoices" RENAME COLUMN "branch_id" TO "issued_branch_id";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_issued_branch_id_fkey"
  FOREIGN KEY ("issued_branch_id") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoices_issued_branch_id_status_created_at_idx"
  ON "invoices"("issued_branch_id", "status", "created_at");

-- 3. Appointment is intentionally denormalized for operational queries.
-- Enforce that its doctor/branch always match the selected slot's schedule.
CREATE OR REPLACE FUNCTION "validate_appointment_schedule_consistency"()
RETURNS TRIGGER AS $$
DECLARE
  expected_doctor_id UUID;
  expected_branch_id UUID;
BEGIN
  SELECT ds."doctor_id", ds."branch_id"
  INTO expected_doctor_id, expected_branch_id
  FROM "doctor_schedule_slots" dss
  JOIN "doctor_schedules" ds ON ds."id" = dss."schedule_id"
  WHERE dss."id" = NEW."schedule_slot_id";

  IF expected_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Schedule slot % does not exist', NEW."schedule_slot_id"
      USING ERRCODE = '23503';
  END IF;

  IF NEW."doctor_id" IS DISTINCT FROM expected_doctor_id
     OR NEW."branch_id" IS DISTINCT FROM expected_branch_id THEN
    RAISE EXCEPTION 'Appointment doctor/branch must match its schedule slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "appointments_schedule_consistency_trg"
BEFORE INSERT OR UPDATE OF "schedule_slot_id", "doctor_id", "branch_id"
ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "validate_appointment_schedule_consistency"();

-- Prevent changing a schedule owner when appointments already reference its slots.
CREATE OR REPLACE FUNCTION "protect_referenced_schedule_owner"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "appointments" a
    JOIN "doctor_schedule_slots" dss ON dss."id" = a."schedule_slot_id"
    WHERE dss."schedule_id" = OLD."id"
      AND (a."doctor_id" IS DISTINCT FROM NEW."doctor_id"
        OR a."branch_id" IS DISTINCT FROM NEW."branch_id")
  ) THEN
    RAISE EXCEPTION 'Cannot change doctor/branch of a schedule referenced by appointments'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "doctor_schedules_protect_owner_trg"
BEFORE UPDATE OF "doctor_id", "branch_id"
ON "doctor_schedules"
FOR EACH ROW EXECUTE FUNCTION "protect_referenced_schedule_owner"();

-- Prevent moving a referenced slot to an incompatible schedule.
CREATE OR REPLACE FUNCTION "protect_referenced_slot_schedule"()
RETURNS TRIGGER AS $$
DECLARE
  target_doctor_id UUID;
  target_branch_id UUID;
BEGIN
  IF NEW."schedule_id" IS NOT DISTINCT FROM OLD."schedule_id" THEN
    RETURN NEW;
  END IF;

  SELECT "doctor_id", "branch_id"
  INTO target_doctor_id, target_branch_id
  FROM "doctor_schedules"
  WHERE "id" = NEW."schedule_id";

  IF EXISTS (
    SELECT 1 FROM "appointments" a
    WHERE a."schedule_slot_id" = OLD."id"
      AND (a."doctor_id" IS DISTINCT FROM target_doctor_id
        OR a."branch_id" IS DISTINCT FROM target_branch_id)
  ) THEN
    RAISE EXCEPTION 'Cannot move a referenced slot to a different doctor/branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "doctor_schedule_slots_protect_schedule_trg"
BEFORE UPDATE OF "schedule_id"
ON "doctor_schedule_slots"
FOR EACH ROW EXECUTE FUNCTION "protect_referenced_slot_schedule"();
