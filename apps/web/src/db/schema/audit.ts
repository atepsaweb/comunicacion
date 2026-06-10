// Tabla de auditoría: registra acciones importantes realizadas por los usuarios en el sistema.
// Sirve para saber quién hizo qué y cuándo, lo que es fundamental para un sistema gremial
// donde la transparencia interna es un valor central.
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';

export const auditLog = appSchema.table('audit_log', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Quién realizó la acción
  actor_user_id: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Qué acción fue (ej: 'approve_publication', 'update_user', 'discard_publication')
  action: text('action').notNull(),
  // Sobre qué tipo de entidad (ej: 'publication', 'user', 'consolidation')
  entity_type: text('entity_type').notNull(),
  // ID de la entidad afectada
  entity_id: uuid('entity_id').notNull(),
  // Estado de la entidad antes del cambio (null si era creación)
  before: jsonb('before'),
  // Estado de la entidad después del cambio (null si era eliminación)
  after: jsonb('after'),
  // Información adicional relevante sobre la acción
  meta: jsonb('meta'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
