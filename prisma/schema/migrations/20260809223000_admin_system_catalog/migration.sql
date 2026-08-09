ALTER TABLE "medicines"
  ADD COLUMN "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "stock_quantity" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "medical_services" (
  "id" UUID NOT NULL,
  "department_id" INTEGER,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "duration_min" INTEGER NOT NULL DEFAULT 30,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "medical_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "medical_services_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "medical_services_code_key" ON "medical_services"("code");
CREATE INDEX "medical_services_department_id_is_active_idx" ON "medical_services"("department_id", "is_active");
CREATE INDEX "medical_services_name_is_active_idx" ON "medical_services"("name", "is_active");
