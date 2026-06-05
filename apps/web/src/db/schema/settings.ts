// Tabla de configuración del sistema.
// Guarda parámetros configurables sin necesidad de tocar el código ni reiniciar el servidor.
// Ejemplos: hora de apertura del ciclo semanal, textos del bot, templates de Meta.
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appSchema, users } from './users';

export const systemSettings = appSchema.table('system_settings', {
  // La clave es el identificador único del parámetro (ej: 'cycle.trigger_time', 'whatsapp_meta_templates')
  key: text('key').primaryKey(),
  // El valor puede ser cualquier tipo JSON: string, número, objeto, array
  value: jsonb('value').notNull(),
  // Quién modificó este parámetro por última vez
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
