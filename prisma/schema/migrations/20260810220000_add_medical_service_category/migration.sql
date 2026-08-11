CREATE TYPE "MedicalServiceCategory" AS ENUM ('LAB_TEST', 'IMAGING', 'PROCEDURE');

ALTER TABLE "medical_services"
ADD COLUMN "category" "MedicalServiceCategory" NOT NULL DEFAULT 'LAB_TEST';

UPDATE "medical_services"
SET "category" = 'PROCEDURE'
WHERE "code" IN ('ECG-REST', 'PROC_ECG');

ALTER TABLE "medical_services"
ALTER COLUMN "category" DROP DEFAULT;

CREATE INDEX "medical_services_category_is_active_name_idx"
ON "medical_services"("category", "is_active", "name");
