import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';

export const auditLog = appSchema.table('audit_log', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  actor_user_id: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  meta: jsonb('meta'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
