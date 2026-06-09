-- Migración 0007: agrega 'event_clarification' al enum outbound_purpose.
-- Permite que parse-event registre los mensajes "necesito la fecha y la hora"
-- como un outbound_message tipado, para que classify-intent pueda detectar
-- el estado de "esperando detalles del evento" y re-enrutar como event_create.
--
-- ADD VALUE no puede correr dentro de una transacción en PostgreSQL.
ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_clarification';
