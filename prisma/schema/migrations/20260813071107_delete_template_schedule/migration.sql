/*
  Warnings:

  - You are about to drop the column `template_id` on the `doctor_schedules` table. All the data in the column will be lost.
  - You are about to drop the `doctor_schedule_templates` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "doctor_schedule_templates" DROP CONSTRAINT "doctor_schedule_templates_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_schedule_templates" DROP CONSTRAINT "doctor_schedule_templates_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_schedules" DROP CONSTRAINT "doctor_schedules_template_id_fkey";

-- AlterTable
ALTER TABLE "doctor_schedule_slots" ADD COLUMN     "is_blocked" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "capacity" SET DEFAULT 1,
ALTER COLUMN "next_queue_number" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "doctor_schedules" DROP COLUMN "template_id",
ADD COLUMN     "slot_duration_min" INTEGER NOT NULL DEFAULT 30;

-- DropTable
DROP TABLE "doctor_schedule_templates";

-- RenameIndex
ALTER INDEX "clinical_orders_assigned_room_id_queue_date_status_queue_number" RENAME TO "clinical_orders_assigned_room_id_queue_date_status_queue_nu_idx";
