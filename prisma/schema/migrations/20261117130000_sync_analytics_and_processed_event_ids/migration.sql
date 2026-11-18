BEGIN;

-- UUIDs cannot be mapped to integer IDs. Stop if records appeared since the
-- preflight check; never cast existing UUIDs or discard populated columns.
LOCK TABLE "analytics_interactions", "processed_events" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "analytics_interactions")
     OR EXISTS (SELECT 1 FROM "processed_events") THEN
    RAISE EXCEPTION 'ID migration requires empty analytics_interactions and processed_events. Existing records need an explicit mapping.';
  END IF;
END $$;

DROP INDEX "analytics_recommendation_event_target_idx";
ALTER TABLE "analytics_interactions"
  ADD COLUMN "target_doctor_id" UUID,
  DROP COLUMN "target_id",
  ADD COLUMN "target_id" INTEGER;
ALTER TABLE "processed_events"
  DROP COLUMN "event_id",
  ADD COLUMN "event_id" INTEGER NOT NULL;

CREATE INDEX "analytics_interactions_session_id_target_id_created_at_idx"
  ON "analytics_interactions"("session_id", "target_id", "created_at");
CREATE INDEX "analytics_interactions_session_id_target_doctor_id_created__idx"
  ON "analytics_interactions"("session_id", "target_doctor_id", "created_at");
CREATE UNIQUE INDEX "analytics_recommendation_event_target_key"
  ON "analytics_interactions"("recommendation_id", "event_type", "target_id");
CREATE UNIQUE INDEX "processed_events_event_id_key" ON "processed_events"("event_id");

COMMIT;
