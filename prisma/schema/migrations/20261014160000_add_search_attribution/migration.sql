CREATE TABLE "search_requests" (
  "id" UUID NOT NULL, "session_id" VARCHAR(100) NOT NULL, "account_id" UUID, "branch_id" UUID,
  "query" VARCHAR(200) NOT NULL, "normalized_query" VARCHAR(200) NOT NULL,
  "intent" JSONB NOT NULL, "result_keys" JSONB NOT NULL, "status" VARCHAR(20) NOT NULL,
  "package_count" INTEGER NOT NULL, "doctor_count" INTEGER NOT NULL, "branch_count" INTEGER NOT NULL,
  "latency_ms" INTEGER NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_requests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "analytics_interactions" (
  "id" UUID NOT NULL, "session_id" VARCHAR(100) NOT NULL, "account_id" UUID, "search_id" UUID,
  "event_type" VARCHAR(20) NOT NULL, "target_type" VARCHAR(20) NOT NULL, "target_id" UUID NOT NULL,
  "position" INTEGER, "branch_id" UUID, "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_interactions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "appointments" ADD COLUMN "search_id" UUID, ADD COLUMN "source_view_id" UUID;
ALTER TABLE "analytics_interactions" ADD CONSTRAINT "analytics_interactions_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "search_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "search_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_source_view_id_fkey" FOREIGN KEY ("source_view_id") REFERENCES "analytics_interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "search_requests_created_at_status_idx" ON "search_requests"("created_at", "status");
CREATE INDEX "search_requests_branch_id_created_at_idx" ON "search_requests"("branch_id", "created_at");
CREATE INDEX "search_requests_session_id_created_at_idx" ON "search_requests"("session_id", "created_at");
CREATE INDEX "analytics_interactions_event_type_occurred_at_idx" ON "analytics_interactions"("event_type", "occurred_at");
CREATE INDEX "analytics_interactions_branch_id_event_type_occurred_at_idx" ON "analytics_interactions"("branch_id", "event_type", "occurred_at");
CREATE INDEX "analytics_interactions_search_id_event_type_idx" ON "analytics_interactions"("search_id", "event_type");
CREATE INDEX "analytics_interactions_session_id_target_id_created_at_idx" ON "analytics_interactions"("session_id", "target_id", "created_at");
CREATE INDEX "appointments_search_id_idx" ON "appointments"("search_id");
CREATE INDEX "appointments_source_view_id_idx" ON "appointments"("source_view_id");
ALTER TABLE "daily_demand_snapshots" ALTER COLUMN "overall_conversion_rate" DROP NOT NULL, ALTER COLUMN "overall_conversion_rate" DROP DEFAULT;
ALTER TABLE "ai_executive_reports" ADD COLUMN "metrics_version" VARCHAR(30) NOT NULL DEFAULT 'legacy';
