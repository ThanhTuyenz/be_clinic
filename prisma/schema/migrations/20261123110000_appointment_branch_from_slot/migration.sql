BEGIN;

LOCK TABLE appointments, doctor_schedule_slots, doctor_schedules, package_reception_slots IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments a
    LEFT JOIN doctor_schedule_slots s ON s.id = a.schedule_slot_id
    LEFT JOIN doctor_schedules ds ON ds.id = s.schedule_id
    LEFT JOIN package_reception_slots r ON r.id = a.reception_slot_id
    WHERE (a.schedule_slot_id IS NULL) = (a.reception_slot_id IS NULL)
       OR a.branch_id IS DISTINCT FROM COALESCE(ds.branch_id, r.branch_id)
  ) THEN
    RAISE EXCEPTION 'Repair appointments with missing/duplicate slots or mismatched branches before dropping branch_id';
  END IF;
END $$;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_one_slot_kind_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_exactly_one_slot_check
  CHECK ((schedule_slot_id IS NOT NULL) <> (reception_slot_id IS NOT NULL));

-- Branch history now lives in the referenced slot. Do not relocate a used source.
CREATE FUNCTION protect_appointment_schedule_branch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND EXISTS (
    SELECT 1 FROM doctor_schedule_slots s JOIN appointments a ON a.schedule_slot_id = s.id
    WHERE s.schedule_id = OLD.id
  ) THEN RAISE EXCEPTION 'Cannot change the branch of a schedule referenced by appointments'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER doctor_schedule_branch_history BEFORE UPDATE OF branch_id ON doctor_schedules
  FOR EACH ROW EXECUTE FUNCTION protect_appointment_schedule_branch();

CREATE FUNCTION protect_appointment_slot_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_branch integer; new_branch integer;
BEGIN
  IF NEW.schedule_id IS DISTINCT FROM OLD.schedule_id AND EXISTS (
    SELECT 1 FROM appointments WHERE schedule_slot_id = OLD.id
  ) THEN
    SELECT branch_id INTO old_branch FROM doctor_schedules WHERE id = OLD.schedule_id FOR SHARE;
    SELECT branch_id INTO new_branch FROM doctor_schedules WHERE id = NEW.schedule_id FOR SHARE;
    IF old_branch IS DISTINCT FROM new_branch THEN
      RAISE EXCEPTION 'Cannot move a slot referenced by appointments to a different branch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER doctor_slot_branch_history BEFORE UPDATE OF schedule_id ON doctor_schedule_slots
  FOR EACH ROW EXECUTE FUNCTION protect_appointment_slot_schedule();

CREATE FUNCTION protect_appointment_reception_branch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND EXISTS (
    SELECT 1 FROM appointments WHERE reception_slot_id = OLD.id
  ) THEN RAISE EXCEPTION 'Cannot change the branch of a reception slot referenced by appointments'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reception_slot_branch_history BEFORE UPDATE OF branch_id ON package_reception_slots
  FOR EACH ROW EXECUTE FUNCTION protect_appointment_reception_branch();

ALTER TABLE appointments DROP COLUMN branch_id;
DROP INDEX IF EXISTS appointments_schedule_slot_id_status_idx;
DROP INDEX IF EXISTS appointments_reception_slot_id_status_idx;
CREATE INDEX appointments_schedule_slot_id_status_created_at_idx ON appointments(schedule_slot_id, status, created_at);
CREATE INDEX appointments_reception_slot_id_status_created_at_idx ON appointments(reception_slot_id, status, created_at);

COMMIT;
