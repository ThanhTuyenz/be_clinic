ALTER TABLE "analytics_interactions"
ADD COLUMN "recommendation_id" UUID,
ADD COLUMN "recommendation_source" VARCHAR(20);

CREATE INDEX "analytics_interactions_recommendation_id_event_type_target_id_idx"
ON "analytics_interactions"("recommendation_id", "event_type", "target_id");
