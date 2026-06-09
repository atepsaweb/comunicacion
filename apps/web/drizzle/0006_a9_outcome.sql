-- Migración 0006: Fase A9 — integración agenda + reporte semanal
-- Aplicar en el VPS:  psql $DATABASE_URL -f 0006_a9_outcome.sql
--
-- Agrega el valor 'event_outcome_reply' al enum message_intent para reconocer
-- respuestas al "¿cómo salió?" del followup de eventos.
-- Los ALTER TYPE ADD VALUE deben correr en autocommit (no envolver en transacción).

ALTER TYPE "public"."message_intent" ADD VALUE IF NOT EXISTS 'event_outcome_reply';
