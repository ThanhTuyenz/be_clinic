ALTER TABLE "examinations" RENAME TO "medical_visits";

ALTER TABLE "medical_visits"
RENAME CONSTRAINT "examinations_pkey" TO "medical_visits_pkey";

ALTER TABLE "medical_visits"
RENAME CONSTRAINT "examinations_appointment_id_fkey" TO "medical_visits_appointment_id_fkey";

ALTER TABLE "medical_visits"
RENAME CONSTRAINT "examinations_created_by_id_fkey" TO "medical_visits_created_by_id_fkey";

ALTER TABLE "medical_visits"
RENAME CONSTRAINT "examinations_medical_record_id_fkey" TO "medical_visits_medical_record_id_fkey";

ALTER INDEX "examinations_appointment_id_key"
RENAME TO "medical_visits_appointment_id_key";

ALTER INDEX "examinations_created_by_id_updated_at_idx"
RENAME TO "medical_visits_created_by_id_updated_at_idx";

ALTER INDEX "examinations_medical_record_id_created_at_idx"
RENAME TO "medical_visits_medical_record_id_created_at_idx";
