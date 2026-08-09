CREATE TABLE "examinations" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "examinations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicines" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "active_ingredient" VARCHAR(255),
    "strength" VARCHAR(100),
    "unit" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "icd10_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "department_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "examinations_appointment_id_key" ON "examinations"("appointment_id");
CREATE INDEX "examinations_created_by_id_updated_at_idx" ON "examinations"("created_by_id", "updated_at");
CREATE UNIQUE INDEX "medicines_code_key" ON "medicines"("code");
CREATE INDEX "medicines_name_is_active_idx" ON "medicines"("name", "is_active");
CREATE UNIQUE INDEX "icd10_codes_code_key" ON "icd10_codes"("code");
CREATE INDEX "icd10_codes_description_is_active_idx" ON "icd10_codes"("description", "is_active");

ALTER TABLE "examinations" ADD CONSTRAINT "examinations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
