ALTER TABLE "clinical_orders"
ADD COLUMN "assigned_room_id" UUID,
ADD COLUMN "queue_date" DATE,
ADD COLUMN "queue_number" INTEGER,
ADD COLUMN "received_at" TIMESTAMPTZ(3);

CREATE INDEX "clinical_orders_assigned_room_id_queue_date_status_queue_number_idx"
ON "clinical_orders"("assigned_room_id", "queue_date", "status", "queue_number");

ALTER TABLE "clinical_orders"
ADD CONSTRAINT "clinical_orders_assigned_room_id_fkey"
FOREIGN KEY ("assigned_room_id") REFERENCES "clinic_rooms"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
