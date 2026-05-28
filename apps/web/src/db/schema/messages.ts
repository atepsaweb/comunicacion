import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { messageKindEnum, messageIntentEnum, outboundPurposeEnum, deliveryStatusEnum } from './enums';

export const inboundMessages = appSchema.table('inbound_messages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  provider: text('provider').notNull(),
  provider_message_id: text('provider_message_id').notNull(),
  from_phone_e164: text('from_phone_e164').notNull(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
  cycle_id: uuid('cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  kind: messageKindEnum('kind').notNull(),
  text_content: text('text_content'),
  audio_path: text('audio_path'),
  audio_duration_sec: integer('audio_duration_sec'),
  raw_payload: jsonb('raw_payload').notNull(),
  intent: messageIntentEnum('intent'),
  received_at: timestamp('received_at', { withTimezone: true }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  discarded_at: timestamp('discarded_at', { withTimezone: true }),
  discard_reason: text('discard_reason'),
});

export const transcriptions = appSchema.table('transcriptions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  inbound_message_id: uuid('inbound_message_id').notNull().unique().references(() => inboundMessages.id, { onDelete: 'restrict' }),
  text: text('text').notNull(),
  language: text('language').notNull().default('es'),
  model: text('model').notNull(),
  duration_sec: integer('duration_sec').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outboundMessages = appSchema.table('outbound_messages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  provider: text('provider').notNull(),
  provider_message_id: text('provider_message_id'),
  to_phone_e164: text('to_phone_e164').notNull(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
  cycle_id: uuid('cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  purpose: outboundPurposeEnum('purpose').notNull(),
  body: text('body').notNull(),
  meta: jsonb('meta'),
  sent_at: timestamp('sent_at', { withTimezone: true }).notNull(),
  delivery_status: deliveryStatusEnum('delivery_status').notNull().default('sent'),
  error: text('error'),
});

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
