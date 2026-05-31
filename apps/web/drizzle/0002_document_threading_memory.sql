-- Migración 0002: soporte de documentos, threading de conversación y memoria cross-week
-- Aplicar en el VPS: psql $DATABASE_URL -f 0002_document_threading_memory.sql

-- 1. Nuevos campos en inbound_messages
ALTER TABLE "app"."inbound_messages" ADD COLUMN IF NOT EXISTS "mime_type" text;
ALTER TABLE "app"."inbound_messages" ADD COLUMN IF NOT EXISTS "document_path" text;
ALTER TABLE "app"."inbound_messages" ADD COLUMN IF NOT EXISTS "quoted_wamid" text;
ALTER TABLE "app"."inbound_messages" ADD COLUMN IF NOT EXISTS "quoted_body" text;

-- 2. Tabla para resultados de extracción de documentos e imágenes
CREATE TABLE IF NOT EXISTS "app"."document_extractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inbound_message_id" uuid NOT NULL,
  "text" text NOT NULL,
  "extraction_method" text NOT NULL, -- 'claude_vision' | 'pdf_extract' | 'docx_extract'
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_extractions_inbound_message_id_unique" UNIQUE("inbound_message_id")
);

DO $$ BEGIN
  ALTER TABLE "app"."document_extractions"
    ADD CONSTRAINT "document_extractions_inbound_message_id_fk"
    FOREIGN KEY ("inbound_message_id") REFERENCES "app"."inbound_messages"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
