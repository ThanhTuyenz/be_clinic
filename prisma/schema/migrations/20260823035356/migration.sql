/*
  Warnings:

  - The values [IN_EXAMINATION] on the enum `AppointmentStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [pharmacist,cashier] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `is_blocked` on the `doctor_schedule_slots` table. All the data in the column will be lost.
  - You are about to drop the column `department_id` on the `doctors` table. All the data in the column will be lost.
  - You are about to drop the column `full_name` on the `doctors` table. All the data in the column will be lost.
  - You are about to drop the column `cashier_id` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `department_id` on the `medical_services` table. All the data in the column will be lost.
  - You are about to drop the column `department_id` on the `specialties` table. All the data in the column will be lost.
  - You are about to drop the `clinical_orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `departments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `icd10_codes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `inventory_movements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `inventory_stocks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `medical_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `medical_visits` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `medicines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `prescription_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `prescriptions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `visit_diagnoses` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[booking_order_id]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `specialties` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `specialties` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('AVAILABLE', 'FULL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BookingOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PARTIALLY_CANCELLED', 'CANCELLED', 'REFUNDED');

-- AlterEnum
BEGIN;
CREATE TYPE "AppointmentStatus_new" AS ENUM ('PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'REFUND_REQUIRED', 'MANUAL_REVIEW');
ALTER TABLE "public"."appointments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "appointments" ALTER COLUMN "status" TYPE "AppointmentStatus_new" USING ("status"::text::"AppointmentStatus_new");
ALTER TABLE "appointment_status_histories" ALTER COLUMN "from_status" TYPE "AppointmentStatus_new" USING ("from_status"::text::"AppointmentStatus_new");
ALTER TABLE "appointment_status_histories" ALTER COLUMN "to_status" TYPE "AppointmentStatus_new" USING ("to_status"::text::"AppointmentStatus_new");
ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";
ALTER TYPE "AppointmentStatus_new" RENAME TO "AppointmentStatus";
DROP TYPE "public"."AppointmentStatus_old";
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';
COMMIT;

-- AlterEnum
ALTER TYPE "MedicalServiceCategory" ADD VALUE 'CONSULTATION';

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('admin', 'branch_manager', 'doctor', 'receptionist', 'patient');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'patient';
COMMIT;

-- DropForeignKey
ALTER TABLE "clinical_orders" DROP CONSTRAINT "clinical_orders_assigned_room_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_orders" DROP CONSTRAINT "clinical_orders_medical_service_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_orders" DROP CONSTRAINT "clinical_orders_medical_visit_id_fkey";

-- DropForeignKey
ALTER TABLE "doctors" DROP CONSTRAINT "doctors_department_id_fkey";

-- DropForeignKey
ALTER TABLE "icd10_codes" DROP CONSTRAINT "icd10_codes_department_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_medicine_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_stocks" DROP CONSTRAINT "inventory_stocks_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_stocks" DROP CONSTRAINT "inventory_stocks_medicine_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_cashier_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_patient_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_services" DROP CONSTRAINT "medical_services_department_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_visits" DROP CONSTRAINT "medical_visits_medical_record_id_fkey";

-- DropForeignKey
ALTER TABLE "prescription_items" DROP CONSTRAINT "prescription_items_medicine_id_fkey";

-- DropForeignKey
ALTER TABLE "prescription_items" DROP CONSTRAINT "prescription_items_prescription_id_fkey";

-- DropForeignKey
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_medical_visit_id_fkey";

-- DropForeignKey
ALTER TABLE "specialties" DROP CONSTRAINT "specialties_department_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_diagnoses" DROP CONSTRAINT "visit_diagnoses_icd10_code_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_diagnoses" DROP CONSTRAINT "visit_diagnoses_medical_visit_id_fkey";

-- DropIndex
DROP INDEX "appointments_schedule_slot_id_queue_number_key";

-- DropIndex
DROP INDEX "doctor_schedule_slots_schedule_id_is_active_idx";

-- DropIndex
DROP INDEX "doctors_department_id_is_active_idx";

-- DropIndex
DROP INDEX "medical_services_department_id_is_active_idx";

-- DropIndex
DROP INDEX "specialties_department_id_name_key";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "booking_order_id" UUID,
ADD COLUMN     "reminder_sent_24h" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminder_sent_2h" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "doctor_schedule_slots" DROP COLUMN "is_blocked",
ADD COLUMN     "slot_status" "SlotStatus" NOT NULL DEFAULT 'AVAILABLE';

-- AlterTable
ALTER TABLE "doctor_schedules" ADD COLUMN     "capacity_per_slot" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "doctors" DROP COLUMN "department_id",
DROP COLUMN "full_name",
ADD COLUMN     "avatar_url" VARCHAR(500);

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "cashier_id",
ADD COLUMN     "booking_order_id" UUID,
ALTER COLUMN "appointment_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "medical_services" DROP COLUMN "department_id",
ADD COLUMN     "specialty_id" INTEGER;

-- AlterTable
ALTER TABLE "patient_profiles" ADD COLUMN     "district_code" VARCHAR(20),
ADD COLUMN     "district_name" VARCHAR(100),
ADD COLUMN     "ethnicity" VARCHAR(50),
ADD COLUMN     "guardian_name" VARCHAR(100),
ADD COLUMN     "guardian_phone" VARCHAR(20),
ADD COLUMN     "guardian_relationship" VARCHAR(50),
ADD COLUMN     "nationality" VARCHAR(50) DEFAULT 'Việt Nam',
ADD COLUMN     "occupation" VARCHAR(100),
ADD COLUMN     "phone_number" VARCHAR(20),
ADD COLUMN     "province_code" VARCHAR(20),
ADD COLUMN     "province_name" VARCHAR(100),
ADD COLUMN     "street_address" VARCHAR(255),
ADD COLUMN     "ward_code" VARCHAR(20),
ADD COLUMN     "ward_name" VARCHAR(100);

-- AlterTable
ALTER TABLE "specialties" DROP COLUMN "department_id",
ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "icon_url" VARCHAR(500),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" VARCHAR(120),
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "clinical_orders";

-- DropTable
DROP TABLE "departments";

-- DropTable
DROP TABLE "icd10_codes";

-- DropTable
DROP TABLE "inventory_movements";

-- DropTable
DROP TABLE "inventory_stocks";

-- DropTable
DROP TABLE "medical_records";

-- DropTable
DROP TABLE "medical_visits";

-- DropTable
DROP TABLE "medicines";

-- DropTable
DROP TABLE "prescription_items";

-- DropTable
DROP TABLE "prescriptions";

-- DropTable
DROP TABLE "visit_diagnoses";

-- DropEnum
DROP TYPE "ClinicalOrderStatus";

-- DropEnum
DROP TYPE "InventoryMovementType";

-- DropEnum
DROP TYPE "MedicalVisitStatus";

-- DropEnum
DROP TYPE "PrescriptionStatus";

-- CreateTable
CREATE TABLE "booking_orders" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "order_code" VARCHAR(30) NOT NULL,
    "group_type" VARCHAR(20) NOT NULL DEFAULT 'SINGLE',
    "status" "BookingOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receptionists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(50) NOT NULL,
    "desk_number" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receptionists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_orders_order_code_key" ON "booking_orders"("order_code");

-- CreateIndex
CREATE INDEX "booking_orders_account_id_status_idx" ON "booking_orders"("account_id", "status");

-- CreateIndex
CREATE INDEX "booking_orders_status_created_at_idx" ON "booking_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "receptionists_user_id_key" ON "receptionists"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "receptionists_employee_code_key" ON "receptionists"("employee_code");

-- CreateIndex
CREATE INDEX "receptionists_is_active_idx" ON "receptionists"("is_active");

-- CreateIndex
CREATE INDEX "appointments_booking_order_id_idx" ON "appointments"("booking_order_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_slots_schedule_id_slot_status_is_active_idx" ON "doctor_schedule_slots"("schedule_id", "slot_status", "is_active");

-- CreateIndex
CREATE INDEX "doctor_schedule_slots_schedule_id_is_active_occupied_count_idx" ON "doctor_schedule_slots"("schedule_id", "is_active", "occupied_count");

-- CreateIndex
CREATE INDEX "doctor_schedules_doctor_id_work_date_status_idx" ON "doctor_schedules"("doctor_id", "work_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_booking_order_id_key" ON "invoices"("booking_order_id");

-- CreateIndex
CREATE INDEX "medical_services_specialty_id_is_active_idx" ON "medical_services"("specialty_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_name_key" ON "specialties"("name");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_slug_key" ON "specialties"("slug");

-- CreateIndex
CREATE INDEX "specialties_is_active_sort_order_idx" ON "specialties"("is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "medical_services" ADD CONSTRAINT "medical_services_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_orders" ADD CONSTRAINT "booking_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_order_id_fkey" FOREIGN KEY ("booking_order_id") REFERENCES "booking_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionists" ADD CONSTRAINT "receptionists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_order_id_fkey" FOREIGN KEY ("booking_order_id") REFERENCES "booking_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
