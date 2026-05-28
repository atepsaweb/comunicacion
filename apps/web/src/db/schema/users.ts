import { pgSchema, text, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { userRoleEnum } from './enums';

export const appSchema = pgSchema('app');

export const users = appSchema.table('users', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  full_name: text('full_name').notNull(),
  email: text('email').unique(),
  phone_e164: text('phone_e164').notNull().unique(),
  role: userRoleEnum('role').notNull().default('secretary'),
  position: text('position'),
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
