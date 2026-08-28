/*
  Warnings:

  - You are about to drop the `medical_services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `service_package_items` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AIConversationType" AS ENUM ('TRIAGE_CONSULTATION', 'GENERAL_INQUIRY', 'BOOKING_ASSISTANCE');

-- CreateEnum
CREATE TYPE "AIMessageSender" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "medical_services" DROP CONSTRAINT "medical_services_specialty_id_fkey";

-- DropForeignKey
ALTER TABLE "service_package_items" DROP CONSTRAINT "service_package_items_medical_service_id_fkey";

-- DropForeignKey
ALTER TABLE "service_package_items" DROP CONSTRAINT "service_package_items_service_package_id_fkey";

-- DropTable
DROP TABLE "medical_services";

-- DropTable
DROP TABLE "service_package_items";

-- DropEnum
DROP TYPE "MedicalServiceCategory";

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "conversation_type" "AIConversationType" NOT NULL DEFAULT 'TRIAGE_CONSULTATION',
    "title" VARCHAR(255),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender" "AIMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "raw_audio_url" VARCHAR(500),
    "structured_response" JSONB,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_triage_insights" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "extracted_symptoms" TEXT NOT NULL,
    "preliminary_diagnosis" TEXT,
    "user_latitude" DOUBLE PRECISION,
    "user_longitude" DOUBLE PRECISION,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "suggested_specialty_id" INTEGER,
    "suggested_doctor_id" UUID,
    "suggested_branch_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_triage_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_booking_intent_logs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID,
    "detected_intent" VARCHAR(100) NOT NULL,
    "target_date" DATE,
    "target_time_slot" VARCHAR(50),
    "extracted_params" JSONB,
    "is_successful" BOOLEAN NOT NULL DEFAULT false,
    "appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_booking_intent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_created_at_idx" ON "ai_conversations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_triage_insights_conversation_id_idx" ON "ai_triage_insights"("conversation_id");

-- CreateIndex
CREATE INDEX "ai_booking_intent_logs_conversation_id_idx" ON "ai_booking_intent_logs"("conversation_id");

-- CreateIndex
CREATE INDEX "ai_booking_intent_logs_user_id_idx" ON "ai_booking_intent_logs"("user_id");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_triage_insights" ADD CONSTRAINT "ai_triage_insights_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_triage_insights" ADD CONSTRAINT "ai_triage_insights_suggested_specialty_id_fkey" FOREIGN KEY ("suggested_specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_triage_insights" ADD CONSTRAINT "ai_triage_insights_suggested_doctor_id_fkey" FOREIGN KEY ("suggested_doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_triage_insights" ADD CONSTRAINT "ai_triage_insights_suggested_branch_id_fkey" FOREIGN KEY ("suggested_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_booking_intent_logs" ADD CONSTRAINT "ai_booking_intent_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_booking_intent_logs" ADD CONSTRAINT "ai_booking_intent_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_booking_intent_logs" ADD CONSTRAINT "ai_booking_intent_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
