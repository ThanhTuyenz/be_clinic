UPDATE "prescriptions" AS p
SET "status" = 'ISSUED', "issued_at" = COALESCE(p."issued_at", mv."finalized_at", NOW())
FROM "medical_visits" AS mv
WHERE p."medical_visit_id" = mv."id"
  AND p."status" = 'DRAFT'
  AND mv."status" = 'FINALIZED'
  AND EXISTS (SELECT 1 FROM "prescription_items" pi WHERE pi."prescription_id" = p."id");
