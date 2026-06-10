// Tabla de ausencias de secretarios.
// Cuando un secretario está de licencia o avisa que no va a reportar esa semana,
// se registra una ausencia. El sistema la tiene en cuenta para no marcarlo
// como "no reportó" ni enviarle recordatorios.
import { date, timestamp, text, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { absenceTypeEnum, absenceSourceEnum } from './enums';

export const absences = appSchema.table('absences', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Quién está ausente
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Tipo de ausencia: licencia programada o pausa semanal
  type: absenceTypeEnum('type').notNull(),
  // Rango de fechas de la ausencia (solo la fecha, sin hora)
  starts_on: date('starts_on').notNull(),
  ends_on: date('ends_on').notNull(),
  // Motivo opcional (ej: "vacaciones", "enfermedad", "comisión sindical")
  reason: text('reason'),
  // Cómo se registró esta ausencia
  source: absenceSourceEnum('source').notNull(),
  // Quién cargó la ausencia (el propio secretario o el admin)
  registered_by: uuid('registered_by').references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Absence = typeof absences.$inferSelect;
export type NewAbsence = typeof absences.$inferInsert;
