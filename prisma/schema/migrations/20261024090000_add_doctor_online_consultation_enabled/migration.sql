-- Preserve online availability for existing doctors; new doctors opt in explicitly.
ALTER TABLE "doctors"
ADD COLUMN "is_online_consultation_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "doctors"
ALTER COLUMN "is_online_consultation_enabled" SET DEFAULT false;
