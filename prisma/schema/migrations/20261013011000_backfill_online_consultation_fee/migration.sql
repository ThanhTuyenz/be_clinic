UPDATE "doctors"
SET "online_consultation_fee" = ROUND(("consultation_fee" * 0.8) / 10000) * 10000
WHERE "online_consultation_fee" IS NULL;
