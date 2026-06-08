// Tablas de publicaciones y consolidados.
// Al cerrar un ciclo, la IA genera un "consolidado" (resumen unificado de todos los reportes)
// y a partir de él crea "publicaciones" listas para cada canal (Instagram, newsletter, etc.).
// Julián revisa y aprueba antes de que se publique cualquier cosa.
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

// El consolidado es el resumen unificado de todos los reportes de un ciclo.
// Hay uno por ciclo (relación uno a uno, forzada por .unique() en cycle_id).
export const consolidations = appSchema.table('consolidations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Un solo consolidado por ciclo
  cycle_id: uuid('cycle_id').notNull().unique().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  // El resumen completo en formato Markdown, listo para distribuir internamente
  internal_summary_md: text('internal_summary_md').notNull(),
  // Informe de verificación de referencias legales generado por la IA con búsqueda web.
  // Null hasta que Julián ejecuta el paso de verificación desde el panel.
  verification_notes_md: text('verification_notes_md'),
  // Temas principales detectados en los reportes (JSON: lista de strings)
  themes: jsonb('themes').notNull(),
  // Métricas de participación (JSON: cuántos reportaron, completitud promedio, etc.)
  metrics: jsonb('metrics').notNull(),
  generated_at: timestamp('generated_at', { withTimezone: true }).notNull(),
  // Quién revisó y aprobó el consolidado
  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  status: consolidationStatusEnum('status').notNull().default('draft'),
});

// Nota técnica: publications y publication_versions tienen una referencia circular
// (cada publicación apunta a su versión actual, y cada versión apunta a su publicación).
// Están en el mismo archivo para evitar problemas de importación cíclica.
// publications.current_version_id → publication_versions.id (se completa después de crear la primera versión).

// Una publicación representa el texto para un canal específico (ej: Instagram del ciclo N).
// Puede tener múltiples versiones si Julián la edita o la IA regenera.
export const publications = appSchema.table('publications', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  cycle_id: uuid('cycle_id').notNull().references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  consolidation_id: uuid('consolidation_id').notNull().references(() => consolidations.id, { onDelete: 'restrict' }),
  // Para qué canal es esta publicación (Instagram, newsletter, etc.)
  kind: publicationKindEnum('kind').notNull(),
  // Apunta a la versión actualmente activa (null hasta que se crea la primera versión).
  // Usamos uuid sin .references() para evitar el problema de la referencia circular.
  current_version_id: uuid('current_version_id'),
  status: publicationStatusEnum('status').notNull().default('draft'),
  // Cuándo y dónde se publicó (null si todavía no se publicó)
  published_at: timestamp('published_at', { withTimezone: true }),
  published_url: text('published_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cada vez que se edita o regenera una publicación, se crea una nueva versión.
// El historial de versiones queda guardado para poder volver atrás si es necesario.
export const publicationVersions = appSchema.table('publication_versions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  publication_id: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'restrict' }),
  // Número de versión secuencial (1, 2, 3...) dentro de esa publicación
  version_number: integer('version_number').notNull(),
  // El texto completo de la publicación en formato Markdown
  body_md: text('body_md').notNull(),
  // Archivos adjuntos opcionales (ej: imágenes para Instagram)
  attachments: jsonb('attachments'),
  // Metadatos adicionales (ej: hashtags sugeridos, longitud del texto)
  meta: jsonb('meta'),
  // Si la generó la IA o la editó un humano
  source: publicationVersionSourceEnum('source').notNull(),
  // Quién creó esta versión (null si fue generada automáticamente por la IA)
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  // Referencia a la llamada de IA que generó esta versión (null si fue edición humana)
  ai_invocation_id: uuid('ai_invocation_id').references(() => aiInvocations.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Consolidation = typeof consolidations.$inferSelect;
export type NewConsolidation = typeof consolidations.$inferInsert;
export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;
export type PublicationVersion = typeof publicationVersions.$inferSelect;
export type NewPublicationVersion = typeof publicationVersions.$inferInsert;
