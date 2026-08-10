CREATE TABLE "specialty_services" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "specialty_id" INTEGER NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "duration_min" INTEGER NOT NULL DEFAULT 30,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "specialty_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_packages" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "health_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_package_items" (
  "health_package_id" UUID NOT NULL,
  "medical_service_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "health_package_items_pkey" PRIMARY KEY ("health_package_id", "medical_service_id")
);

ALTER TABLE "appointments" ADD COLUMN "specialty_service_id" UUID;
ALTER TABLE "appointments" ADD COLUMN "service_price" DECIMAL(12,2);

CREATE UNIQUE INDEX "specialty_services_code_key" ON "specialty_services"("code");
CREATE UNIQUE INDEX "specialty_services_branch_id_specialty_id_name_key" ON "specialty_services"("branch_id", "specialty_id", "name");
CREATE INDEX "specialty_services_branch_id_specialty_id_is_active_idx" ON "specialty_services"("branch_id", "specialty_id", "is_active");
CREATE UNIQUE INDEX "health_packages_code_key" ON "health_packages"("code");
CREATE UNIQUE INDEX "health_packages_branch_id_code_key" ON "health_packages"("branch_id", "code");
CREATE INDEX "health_packages_branch_id_is_active_name_idx" ON "health_packages"("branch_id", "is_active", "name");
CREATE INDEX "health_package_items_medical_service_id_idx" ON "health_package_items"("medical_service_id");
CREATE INDEX "appointments_specialty_service_id_status_idx" ON "appointments"("specialty_service_id", "status");

ALTER TABLE "specialty_services" ADD CONSTRAINT "specialty_services_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "specialty_services" ADD CONSTRAINT "specialty_services_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "health_packages" ADD CONSTRAINT "health_packages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "health_package_items" ADD CONSTRAINT "health_package_items_health_package_id_fkey" FOREIGN KEY ("health_package_id") REFERENCES "health_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_package_items" ADD CONSTRAINT "health_package_items_medical_service_id_fkey" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_specialty_service_id_fkey" FOREIGN KEY ("specialty_service_id") REFERENCES "specialty_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "specialty_services" ADD CONSTRAINT "specialty_services_price_check" CHECK ("price" >= 0);
ALTER TABLE "specialty_services" ADD CONSTRAINT "specialty_services_duration_check" CHECK ("duration_min" > 0);
ALTER TABLE "health_packages" ADD CONSTRAINT "health_packages_price_check" CHECK ("price" >= 0);
ALTER TABLE "health_package_items" ADD CONSTRAINT "health_package_items_quantity_check" CHECK ("quantity" > 0);
