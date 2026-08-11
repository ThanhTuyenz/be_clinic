CREATE OR REPLACE FUNCTION validate_appointment_schedule_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_doctor_id UUID;
  doctor_branch_id UUID;
  expected_service_package_id UUID;
  package_branch_id UUID;
BEGIN
  IF NEW."service_package_schedule_slot_id" IS NOT NULL THEN
    SELECT sps."service_package_id", bbm."branch_id"
      INTO expected_service_package_id, package_branch_id
    FROM "service_package_schedule_slots" spss
    JOIN "service_package_schedules" sps ON sps."id" = spss."schedule_id"
    JOIN "service_packages" sp ON sp."id" = sps."service_package_id"
    JOIN "branch_booking_methods" bbm ON bbm."id" = sp."branch_booking_method_id"
    WHERE spss."id" = NEW."service_package_schedule_slot_id";

    IF expected_service_package_id IS NULL THEN
      RAISE EXCEPTION 'Service package schedule slot % does not exist', NEW."service_package_schedule_slot_id" USING ERRCODE = '23503';
    END IF;
    IF NEW."service_package_id" IS DISTINCT FROM expected_service_package_id OR NEW."branch_id" IS DISTINCT FROM package_branch_id THEN
      RAISE EXCEPTION 'Appointment package/branch must match its service package schedule slot' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."schedule_slot_id" IS NOT NULL THEN
    SELECT ds."doctor_id", ds."branch_id" INTO expected_doctor_id, doctor_branch_id
    FROM "doctor_schedule_slots" dss
    JOIN "doctor_schedules" ds ON ds."id" = dss."schedule_id"
    WHERE dss."id" = NEW."schedule_slot_id";
    IF expected_doctor_id IS NULL THEN
      RAISE EXCEPTION 'Doctor schedule slot % does not exist', NEW."schedule_slot_id" USING ERRCODE = '23503';
    END IF;
    IF NEW."doctor_id" IS DISTINCT FROM expected_doctor_id OR NEW."branch_id" IS DISTINCT FROM doctor_branch_id THEN
      RAISE EXCEPTION 'Appointment doctor/branch must match its doctor schedule slot' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
