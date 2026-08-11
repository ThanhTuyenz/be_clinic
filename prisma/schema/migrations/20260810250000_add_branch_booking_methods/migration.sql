CREATE TYPE "BookingMethodType" AS ENUM ('SPECIALTY_EXAM', 'HEALTH_PACKAGE', 'CONSULTATION', 'AFTER_HOURS');
CREATE TABLE "branch_booking_methods" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "type" "BookingMethodType" NOT NULL,
  "display_name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "branch_booking_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branch_booking_methods_branch_id_type_key" ON "branch_booking_methods"("branch_id", "type");
CREATE INDEX "branch_booking_methods_branch_id_is_enabled_sort_order_idx" ON "branch_booking_methods"("branch_id", "is_enabled", "sort_order");
ALTER TABLE "branch_booking_methods" ADD CONSTRAINT "branch_booking_methods_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
