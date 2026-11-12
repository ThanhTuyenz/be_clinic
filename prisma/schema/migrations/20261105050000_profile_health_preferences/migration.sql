ALTER TABLE "patient_profiles"
  ADD COLUMN "family_history" TEXT,
  ADD COLUMN "smoking_status" VARCHAR(20),
  ADD COLUMN "alcohol_use" VARCHAR(20),
  ADD COLUMN "activity_level" VARCHAR(20),
  ADD COLUMN "pregnancy_status" VARCHAR(20),
  ADD COLUMN "is_breastfeeding" BOOLEAN;
