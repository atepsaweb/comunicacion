import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';

export const otpCodes = appSchema.table('otp_codes', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  phone_e164: text('phone_e164').notNull(),
  code_hash: text('code_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumed_at: timestamp('consumed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OtpCode = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;
