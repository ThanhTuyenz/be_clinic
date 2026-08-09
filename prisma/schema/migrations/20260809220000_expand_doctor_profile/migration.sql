ALTER TABLE "doctors"
  ADD COLUMN "license_number" VARCHAR(50),
  ADD COLUMN "experience_years" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "biography" TEXT,
  ADD COLUMN "slot_duration" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "rating_average" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "doctors_license_number_key" ON "doctors"("license_number");
CREATE INDEX "doctors_is_featured_is_active_idx" ON "doctors"("is_featured", "is_active");

CREATE TABLE "reviews" (
  "id" UUID NOT NULL,
  "doctor_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reviews_doctor_id_reviewer_id_key" ON "reviews"("doctor_id", "reviewer_id");
CREATE INDEX "reviews_doctor_id_is_active_created_at_idx" ON "reviews"("doctor_id", "is_active", "created_at");
CREATE INDEX "reviews_reviewer_id_idx" ON "reviews"("reviewer_id");
