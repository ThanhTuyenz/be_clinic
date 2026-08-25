/*
  Warnings:

  - A unique constraint covering the columns `[patient_code]` on the table `patient_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'IN_EXAMINATION';

-- AlterTable
ALTER TABLE "patient_profiles" ADD COLUMN     "patient_code" VARCHAR(30);

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_patient_code_key" ON "patient_profiles"("patient_code");
