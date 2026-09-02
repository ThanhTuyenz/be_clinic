/*
  Warnings:

  - A unique constraint covering the columns `[account_id,national_id]` on the table `patient_profiles` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[account_id,health_insurance_number]` on the table `patient_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "patient_profiles_health_insurance_number_key";

-- DropIndex
DROP INDEX "patient_profiles_national_id_key";

-- DropIndex
DROP INDEX "patient_profiles_patient_code_key";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "patient_profiles_national_id_idx" ON "patient_profiles"("national_id");

-- CreateIndex
CREATE INDEX "patient_profiles_health_insurance_number_idx" ON "patient_profiles"("health_insurance_number");

-- CreateIndex
CREATE INDEX "patient_profiles_patient_code_idx" ON "patient_profiles"("patient_code");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_account_id_national_id_key" ON "patient_profiles"("account_id", "national_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_account_id_health_insurance_number_key" ON "patient_profiles"("account_id", "health_insurance_number");
