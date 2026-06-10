// Tabla de ciclos semanales de reporte.
// Cada semana el sistema crea un "ciclo" que agrupa todos los mensajes y reportes
// de esa semana. El flujo es: se abre el lunes → los secretarios reportan → se cierra
// el miércoles/jueves → la IA procesa → Julián revisa y publica.
import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema } from './users';
import { cycleStatusEnum } from './enums';

export const weeklyCycles = appSchema.table('weekly_cycles', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Año y número de semana ISO (ej: year=2025, iso_week=22)
  year: integer('year').notNull(),
  iso_week: integer('iso_week').notNull(),
  // Rango del período que cubre el ciclo (lunes a domingo)
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  ends_at: timestamp('ends_at', { withTimezone: true }).notNull(),
  // Momento en que el bot dispara el mensaje inicial a los secretarios pidiendo el reporte
  trigger_at: timestamp('trigger_at', { withTimezone: true }).notNull(),
  // Momento en que el bot envía recordatorios a quienes aún no reportaron
  reminder_at: timestamp('reminder_at', { withTimezone: true }).notNull(),
  // Momento en que el ciclo se cierra (deja de aceptar mensajes)
  closes_at: timestamp('closes_at', { withTimezone: true }).notNull(),
  // Cuándo terminó el procesamiento de la IA (null si todavía no se procesó)
  processed_at: timestamp('processed_at', { withTimezone: true }),
  // Cuándo se publicó el consolidado (null si todavía no se publicó)
  published_at: timestamp('published_at', { withTimezone: true }),
  // Estado actual del ciclo (ver enums.ts)
  status: cycleStatusEnum('status').notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WeeklyCycle = typeof weeklyCycles.$inferSelect;
export type NewWeeklyCycle = typeof weeklyCycles.$inferInsert;
