-- Migración 0005: paso de verificación normativa del consolidado
-- Agrega el propósito 'verify_legal' al enum ai_purpose
-- Agrega la columna verification_notes_md a la tabla consolidations
--
-- Aplicar en el VPS: psql $DATABASE_URL -f 0005_verify_legal.sql
-- Nota: ALTER TYPE ... ADD VALUE corre en autocommit. No envolver en transacción explícita.

ALTER TYPE "public"."ai_purpose" ADD VALUE IF NOT EXISTS 'verify_legal';

ALTER TABLE "app"."consolidations"
  ADD COLUMN IF NOT EXISTS "verification_notes_md" text;
