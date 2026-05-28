import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema } from './users';
import { cycleStatusEnum } from './enums';

export const weeklyCycles = appSchema.table('weekly_cycles', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  year: integer('year').notNull(),
  iso_week: integer('iso_week').notNull(),
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  ends_at: timestamp('ends_at', { withTimezone: true }).notNull(),
  trigger_at: timestamp('trigger_at', { withTimezone: true }).notNull(),
  reminder_at: timestamp('reminder_at', { withTimezone: true }).notNull(),
  closes_at: timestamp('closes_at', { withTimezone: true }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  published_at: timestamp('published_at', { withTimezone: true }),
  status: cycleStatusEnum('status').notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WeeklyCycle = typeof weeklyCycles.$inferSelect;
export type NewWeeklyCycle = typeof weeklyCycles.$inferInsert;
