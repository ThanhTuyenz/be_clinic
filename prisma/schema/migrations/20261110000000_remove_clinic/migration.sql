BEGIN;

-- Branches remain independent records; retain all branch IDs and business data.
ALTER TABLE "branches" DROP CONSTRAINT "branches_clinic_id_fkey";
DROP INDEX "branches_clinic_id_is_active_idx";
ALTER TABLE "branches" DROP COLUMN "clinic_id";
DROP TABLE "clinics";

COMMIT;
