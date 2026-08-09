ALTER TABLE "patient_profiles"
ADD COLUMN "health_insurance_number" VARCHAR(20);

CREATE UNIQUE INDEX "patient_profiles_health_insurance_number_key"
ON "patient_profiles"("health_insurance_number");
