BEGIN;

-- Rename in place: retain rows, references, defaults and sequence ownership.
ALTER TABLE "ai_conversations" RENAME TO "conversations";
ALTER TABLE "ai_messages" RENAME TO "messages";
ALTER TABLE "ai_booking_intent_logs" RENAME TO "booking_intent_logs";
ALTER TYPE "AIConversationType" RENAME TO "ConversationType";
ALTER TYPE "AIMessageSender" RENAME TO "MessageSender";

-- Keep default Prisma constraint/index names aligned with the new table names.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN
    SELECT c.conname, t.relname FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname IN ('conversations', 'messages', 'booking_intent_logs')
      AND left(c.conname, 3) = 'ai_'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
      current_schema(), item.relname, item.conname, substring(item.conname FROM 4));
  END LOOP;
  FOR item IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('conversations', 'messages', 'booking_intent_logs')
      AND left(indexname, 3) = 'ai_'
  LOOP
    EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', current_schema(), item.indexname, substring(item.indexname FROM 4));
  END LOOP;
  FOR item IN
    SELECT t.relname FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relkind = 'S'
      AND t.relname IN ('ai_messages_id_seq', 'ai_booking_intent_logs_id_seq')
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I RENAME TO %I', current_schema(), item.relname, substring(item.relname FROM 4));
  END LOOP;
END $$;

COMMIT;
