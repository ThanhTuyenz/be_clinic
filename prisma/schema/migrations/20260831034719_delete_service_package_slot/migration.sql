/*
  Warnings:

  - You are about to drop the column `service_package_schedule_slot_id` on the `appointments` table. All the data in the column will be lost.
  - You are about to drop the `service_package_schedule_slots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `service_package_schedules` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_service_package_schedule_slot_id_fkey";

-- DropForeignKey
ALTER TABLE "service_package_schedule_slots" DROP CONSTRAINT "service_package_schedule_slots_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "service_package_schedules" DROP CONSTRAINT "service_package_schedules_room_id_fkey";

-- DropForeignKey
ALTER TABLE "service_package_schedules" DROP CONSTRAINT "service_package_schedules_service_package_id_fkey";

-- DropIndex
DROP INDEX "appointments_service_package_schedule_slot_id_status_idx";

-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "service_package_schedule_slot_id";

-- DropTable
DROP TABLE "service_package_schedule_slots";

-- DropTable
DROP TABLE "service_package_schedules";
