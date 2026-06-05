-- Migración 0003: source_message_id en report_items
-- Permite rastrear qué mensaje generó cada ítem y eliminarlo automáticamente
-- cuando el secretario descarta el mensaje fuente.

ALTER TABLE app.report_items
  ADD COLUMN source_message_id uuid
  REFERENCES app.inbound_messages(id) ON DELETE SET NULL;

CREATE INDEX idx_report_items_source_message_id
  ON app.report_items(source_message_id);
