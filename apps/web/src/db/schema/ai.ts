import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { reports } from './reports';
import { aiPurposeEnum, aiTriggeredByEnum } from './enums';

export const prompts = appSchema.table('prompts', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  slug: text('slug').notNull(),
  version: integer('version').notNull(),
  model_hint: text('model_hint').notNull(),
  system_prompt: text('system_prompt').notNull(),
  user_template: text('user_template').notNull(),
  output_schema: jsonb('output_schema'),
  is_active: boolean('is_active').notNull().default(false),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiInvocations = appSchema.table('ai_invocations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  purpose: aiPurposeEnum('purpose').notNull(),
  model: text('model').notNull(),
  prompt_id: uuid('prompt_id').references(() => prompts.id, { onDelete: 'restrict' }),
  input_messages: jsonb('input_messages').notNull(),
  output_text: text('output_text'),
  output_parsed: jsonb('output_parsed'),
  input_tokens: integer('input_tokens').notNull(),
  output_tokens: integer('output_tokens').notNull(),
  cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
  latency_ms: integer('latency_ms').notNull(),
  success: boolean('success').notNull(),
  error: text('error'),
  triggered_by: aiTriggeredByEnum('triggered_by').notNull(),
  related_report_id: uuid('related_report_id').references(() => reports.id, { onDelete: 'restrict' }),
  related_cycle_id: uuid('related_cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type AiInvocation = typeof aiInvocations.$inferSelect;
export type NewAiInvocation = typeof aiInvocations.$inferInsert;
