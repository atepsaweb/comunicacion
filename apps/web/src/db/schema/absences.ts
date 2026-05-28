import { date, timestamp, text, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { absenceTypeEnum, absenceSourceEnum } from './enums';

export const absences = appSchema.table('absences', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  type: absenceTypeEnum('type').notNull(),
  starts_on: date('starts_on').notNull(),
  ends_on: date('ends_on').notNull(),
  reason: text('reason'),
  source: absenceSourceEnum('source').notNull(),
  registered_by: uuid('registered_by').references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Absence = typeof absences.$inferSelect;
export type NewAbsence = typeof absences.$inferInsert;
