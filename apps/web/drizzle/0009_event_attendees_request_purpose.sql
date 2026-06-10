-- Pregunta "¿a quién convoco?" tras confirmar un evento institucional sin mencionados.
-- ADD VALUE debe correr fuera de transacción (autocommit).
ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_attendees_request';
