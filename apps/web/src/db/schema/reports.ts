// Tablas de reportes semanales de cada secretario y sus ítems individuales.
// Cuando un secretario envía sus mensajes, la IA procesa el contenido y genera
// un reporte estructurado con ítems clasificados por categoría y prioridad.
import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { inboundMessages } from './messages';
import { reportStatusEnum, reportItemPriorityEnum } from './enums';

// Un reporte por secretario por ciclo (combinación única de user_id + cycle_id)
export const reports = appSchema.table('reports', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Quién reportó
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // En qué semana reportó
  cycle_id: uuid('cycle_id').notNull().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  // Estado del reporte (ver enums.ts)
  status: reportStatusEnum('status').notNull().default('draft'),
  // Puntaje de completitud asignado por la IA (entre 0.0 y 1.0)
  // Indica qué tan completo e informativo está el reporte
  completeness_score: numeric('completeness_score', { precision: 4, scale: 3 }),
  // Resumen en formato Markdown generado por la IA con todos los ítems del reporte
  summary_md: text('summary_md'),
  // Timestamps del primer y último mensaje recibido en este reporte
  first_message_at: timestamp('first_message_at', { withTimezone: true }),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  // Cuántas veces la IA hizo preguntas de seguimiento para obtener más info
  followup_count: integer('followup_count').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cada ítem es una actividad o novedad específica extraída del reporte por la IA.
// Un reporte puede tener varios ítems (ej: "Reunión con EANA", "Conflicto salarial", etc.)
export const reportItems = appSchema.table('report_items', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  report_id: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'restrict' }),
  // Categoría temática del ítem (ej: "Negociación", "Seguridad operacional", "Conflicto")
  category: text('category').notNull(),
  title: text('title').notNull(),
  // Descripción detallada en formato Markdown
  description_md: text('description_md').notNull(),
  // Personas o entidades mencionadas en el ítem (formato JSON)
  mentions: jsonb('mentions'),
  priority: reportItemPriorityEnum('priority'),
  // Si es true, la IA considera que este ítem puede publicarse externamente (no es confidencial)
  is_public_safe: boolean('is_public_safe').notNull().default(true),
  // Posición del ítem dentro del reporte (para ordenar al mostrar)
  order_index: integer('order_index').notNull(),
  // Mensaje que originó este ítem (para poder eliminarlo si el mensaje se descarta).
  // SET NULL si el mensaje se borra lógicamente.
  source_message_id: uuid('source_message_id').references(() => inboundMessages.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ReportItem = typeof reportItems.$inferSelect;
export type NewReportItem = typeof reportItems.$inferInsert;
