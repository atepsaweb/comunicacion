import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { reportStatusEnum, reportItemPriorityEnum } from './enums';

export const reports = appSchema.table('reports', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  cycle_id: uuid('cycle_id').notNull().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  status: reportStatusEnum('status').notNull().default('draft'),
  completeness_score: numeric('completeness_score', { precision: 4, scale: 3 }),
  summary_md: text('summary_md'),
  first_message_at: timestamp('first_message_at', { withTimezone: true }),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  followup_count: integer('followup_count').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reportItems = appSchema.table('report_items', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  report_id: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'restrict' }),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description_md: text('description_md').notNull(),
  mentions: jsonb('mentions'),
  priority: reportItemPriorityEnum('priority'),
  is_public_safe: boolean('is_public_safe').notNull().default(true),
  order_index: integer('order_index').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ReportItem = typeof reportItems.$inferSelect;
export type NewReportItem = typeof reportItems.$inferInsert;
