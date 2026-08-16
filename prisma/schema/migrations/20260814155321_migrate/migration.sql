/*
  Warnings:

  - You are about to drop the column `doctor_id` on the `appointments` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_doctor_id_fkey";

-- DropIndex
DROP INDEX "appointments_doctor_id_status_created_at_idx";

-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "doctor_id";
