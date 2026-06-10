-- Recordatorio "al momento del evento" (offset 0).
-- ADD VALUE debe correr fuera de transacción (autocommit).
ALTER TYPE "public"."event_notification_kind" ADD VALUE IF NOT EXISTS 'reminder_0h';
