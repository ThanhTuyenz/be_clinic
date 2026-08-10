ALTER TABLE "appointment_status_histories"
ADD CONSTRAINT "appointment_status_histories_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "icd10_codes"
ADD CONSTRAINT "icd10_codes_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "users_is_blocked_is_deleted_idx";
CREATE INDEX "users_is_deleted_created_at_idx"
ON "users"("is_deleted", "created_at");

DROP INDEX IF EXISTS "medicines_name_is_active_idx";
CREATE INDEX "medicines_is_active_name_idx"
ON "medicines"("is_active", "name");

DROP INDEX IF EXISTS "medical_services_name_is_active_idx";
CREATE INDEX "medical_services_is_active_name_idx"
ON "medical_services"("is_active", "name");

DROP INDEX IF EXISTS "icd10_codes_description_is_active_idx";
CREATE INDEX "icd10_codes_department_id_is_active_idx"
ON "icd10_codes"("department_id", "is_active");
CREATE INDEX "icd10_codes_is_active_code_idx"
ON "icd10_codes"("is_active", "code");

CREATE INDEX "appointments_patient_profile_id_created_at_idx"
ON "appointments"("patient_profile_id", "created_at");
CREATE INDEX "appointments_doctor_id_status_created_at_idx"
ON "appointments"("doctor_id", "status", "created_at");

ALTER TABLE "doctors"
ADD CONSTRAINT "doctors_experience_years_check" CHECK ("experience_years" >= 0),
ADD CONSTRAINT "doctors_consultation_fee_check" CHECK ("consultation_fee" >= 0),
ADD CONSTRAINT "doctors_slot_duration_check" CHECK ("slot_duration" > 0),
ADD CONSTRAINT "doctors_rating_average_check" CHECK ("rating_average" >= 0 AND "rating_average" <= 5),
ADD CONSTRAINT "doctors_rating_count_check" CHECK ("rating_count" >= 0);

ALTER TABLE "medicines"
ADD CONSTRAINT "medicines_unit_price_check" CHECK ("unit_price" >= 0),
ADD CONSTRAINT "medicines_stock_quantity_check" CHECK ("stock_quantity" >= 0);

ALTER TABLE "medical_services"
ADD CONSTRAINT "medical_services_price_check" CHECK ("price" >= 0),
ADD CONSTRAINT "medical_services_duration_min_check" CHECK ("duration_min" > 0);

ALTER TABLE "doctor_schedule_slots"
ADD CONSTRAINT "doctor_schedule_slots_next_queue_number_check" CHECK ("next_queue_number" >= 0);
