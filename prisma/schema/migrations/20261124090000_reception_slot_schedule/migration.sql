BEGIN;

LOCK TABLE package_reception_schedules, package_reception_slots, appointments IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE package_reception_schedules ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE package_reception_slots ADD COLUMN reception_schedule_id INTEGER;

UPDATE package_reception_slots r SET reception_schedule_id = s.id
FROM package_reception_schedules s
WHERE s.branch_id = r.branch_id AND s.service_package_id = r.service_package_id
  AND s.day_of_week = EXTRACT(DOW FROM r.date)::integer;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM package_reception_slots WHERE reception_schedule_id IS NULL) THEN
    RAISE EXCEPTION 'Some reception slots have no matching package/branch/weekday schedule; repair them before migrating';
  END IF;
END $$;

ALTER TABLE package_reception_slots ALTER COLUMN reception_schedule_id SET NOT NULL;
ALTER TABLE package_reception_slots ADD CONSTRAINT package_reception_slots_reception_schedule_id_fkey
  FOREIGN KEY (reception_schedule_id) REFERENCES package_reception_schedules(id) ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS reception_slot_branch_history ON package_reception_slots;
DROP FUNCTION IF EXISTS protect_appointment_reception_branch();

-- Stable parent identities preserve every slot's package, branch and weekday.
CREATE FUNCTION protect_reception_schedule_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.branch_id, NEW.service_package_id, NEW.day_of_week)
     IS DISTINCT FROM (OLD.branch_id, OLD.service_package_id, OLD.day_of_week)
     AND EXISTS (SELECT 1 FROM package_reception_slots WHERE reception_schedule_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot change package, branch or weekday of a reception schedule that has slots';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reception_schedule_identity BEFORE UPDATE OF branch_id, service_package_id, day_of_week
  ON package_reception_schedules FOR EACH ROW EXECUTE FUNCTION protect_reception_schedule_identity();

CREATE FUNCTION validate_reception_slot_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source package_reception_schedules%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.reception_schedule_id, NEW.date, NEW.start_time, NEW.end_time)
       IS DISTINCT FROM (OLD.reception_schedule_id, OLD.date, OLD.start_time, OLD.end_time)
       AND EXISTS (SELECT 1 FROM appointments WHERE reception_slot_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot move or retime a reception slot referenced by appointments';
    END IF;
  END IF;
  SELECT * INTO source FROM package_reception_schedules WHERE id = NEW.reception_schedule_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reception schedule does not exist' USING ERRCODE = '23503'; END IF;
  IF source.day_of_week <> EXTRACT(DOW FROM NEW.date)::integer THEN
    RAISE EXCEPTION 'Reception slot date must match the source schedule weekday' USING ERRCODE = '23514';
  END IF;
  IF NOT source.is_active THEN
    RAISE EXCEPTION 'Cannot create or move a slot under an inactive reception schedule';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reception_slot_schedule_check BEFORE INSERT OR UPDATE OF reception_schedule_id, date, start_time, end_time
  ON package_reception_slots FOR EACH ROW EXECUTE FUNCTION validate_reception_slot_schedule();

ALTER TABLE package_reception_slots DROP COLUMN branch_id, DROP COLUMN service_package_id;
CREATE UNIQUE INDEX package_reception_slot_schedule_date_start_key
  ON package_reception_slots(reception_schedule_id, date, start_time);
CREATE INDEX package_reception_slot_schedule_date_active_idx
  ON package_reception_slots(reception_schedule_id, date, is_active);

COMMIT;
