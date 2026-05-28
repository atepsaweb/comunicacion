import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { aiInvocations } from './ai';
import {
  publicationKindEnum,
  publicationStatusEnum,
  publicationVersionSourceEnum,
  consolidationStatusEnum,
} from './enums';

export const consolidations = appSchema.table('consolidations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  cycle_id: uuid('cycle_id').notNull().unique().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  internal_summary_md: text('internal_summary_md').notNull(),
  themes: jsonb('themes').notNull(),
  metrics: jsonb('metrics').notNull(),
  generated_at: timestamp('generated_at', { withTimezone: true }).notNull(),
  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  status: consolidationStatusEnum('status').notNull().default('draft'),
});

// publications and publication_versions have a circular FK.
// Both are defined in the same file to avoid import cycles.
// publications.current_version_id → publication_versions.id (nullable, set after first version is created).

export const publications = appSchema.table('publications', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  cycle_id: uuid('cycle_id').notNull().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  consolidation_id: uuid('consolidation_id').notNull().references(() => consolidations.id, { onDelete: 'restrict' }),
  kind: publicationKindEnum('kind').notNull(),
  // current_version_id is set after the first version is created (deferred FK in SQL sense).
  // We use a plain uuid column without .references() to avoid the circular import + constraint issue.
  current_version_id: uuid('current_version_id'),
  status: publicationStatusEnum('status').notNull().default('draft'),
  published_at: timestamp('published_at', { withTimezone: true }),
  published_url: text('published_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const publicationVersions = appSchema.table('publication_versions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  publication_id: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'restrict' }),
  version_number: integer('version_number').notNull(),
  body_md: text('body_md').notNull(),
  attachments: jsonb('attachments'),
  meta: jsonb('meta'),
  source: publicationVersionSourceEnum('source').notNull(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  ai_invocation_id: uuid('ai_invocation_id').references(() => aiInvocations.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Consolidation = typeof consolidations.$inferSelect;
export type NewConsolidation = typeof consolidations.$inferInsert;
export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;
export type PublicationVersion = typeof publicationVersions.$inferSelect;
export type NewPublicationVersion = typeof publicationVersions.$inferInsert;
