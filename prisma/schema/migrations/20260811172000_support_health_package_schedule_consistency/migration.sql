CREATE OR REPLACE FUNCTION validate_appointment_schedule_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_doctor_id UUID;
  expected_branch_id UUID;
  expected_health_package_id UUID;
BEGIN
  IF NEW."health_package_schedule_slot_id" IS NOT NULL THEN
    SELECT hps."health_package_id", bbm."branch_id"
      INTO expected_health_package_id, expected_branch_id
    FROM "health_package_schedule_slots" hpss
    JOIN "health_package_schedules" hps ON hps."id" = hpss."schedule_id"
    JOIN "health_packages" hp ON hp."id" = hps."health_package_id"
    JOIN "branch_booking_methods" bbm ON bbm."id" = hp."branch_booking_method_id"
    WHERE hpss."id" = NEW."health_package_schedule_slot_id";

    IF expected_health_package_id IS NULL THEN
      RAISE EXCEPTION 'Health package schedule slot % does not exist', NEW."health_package_schedule_slot_id"
        USING ERRCODE = '23503';
    END IF;

    IF NEW."health_package_id" IS DISTINCT FROM expected_health_package_id
       OR NEW."branch_id" IS DISTINCT FROM expected_branch_id
       OR NEW."schedule_slot_id" IS NOT NULL
       OR NEW."doctor_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Appointment health package/branch must match its health package schedule slot'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT ds."doctor_id", ds."branch_id"
    INTO expected_doctor_id, expected_branch_id
  FROM "doctor_schedule_slots" dss
  JOIN "doctor_schedules" ds ON ds."id" = dss."schedule_id"
  WHERE dss."id" = NEW."schedule_slot_id";

  IF expected_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Schedule slot % does not exist', NEW."schedule_slot_id"
      USING ERRCODE = '23503';
  END IF;

  IF NEW."doctor_id" IS DISTINCT FROM expected_doctor_id
     OR NEW."branch_id" IS DISTINCT FROM expected_branch_id THEN
    RAISE EXCEPTION 'Appointment doctor/branch must match its schedule slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
