import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appSchema, users } from './users';

export const systemSettings = appSchema.table('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
