// Tablas de IA: prompts configurables y registro de cada llamada a la API de Claude.
// Esto permite editar los prompts desde el panel sin tocar el código,
// y auditar cuánto se usa la IA, cuánto cuesta, y si hubo errores.
import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { reports } from './reports';
import { aiPurposeEnum, aiTriggeredByEnum } from './enums';

// Versiones de los prompts (instrucciones) que se le dan a la IA.
// Cada prompt tiene un slug (nombre clave) y puede tener múltiples versiones;
// solo una versión por slug puede estar activa a la vez.
export const prompts = appSchema.table('prompts', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Nombre interno del prompt (ej: 'extract-report', 'followup-question')
  slug: text('slug').notNull(),
  // Número de versión (empieza en 1, se incrementa con cada edición)
  version: integer('version').notNull(),
  // Modelo de Claude recomendado para este prompt (ej: 'claude-haiku-4-5-20251001')
  model_hint: text('model_hint').notNull(),
  // El prompt de sistema: instrucciones generales para la IA
  system_prompt: text('system_prompt').notNull(),
  // La plantilla del mensaje del usuario (puede incluir variables como {{texto_secretario}})
  user_template: text('user_template').notNull(),
  // Esquema JSON esperado en la respuesta de la IA (para validar el formato)
  output_schema: jsonb('output_schema'),
  // Solo el prompt con is_active=true se usa en producción
  is_active: boolean('is_active').notNull().default(false),
  // Quién creó esta versión del prompt
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Registro de cada llamada a la API de Claude.
// Se guarda absolutamente todo: qué se le mandó, qué respondió, cuánto tardó y cuánto costó.
// Esto permite auditar el uso y detectar problemas.
export const aiInvocations = appSchema.table('ai_invocations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Para qué se usó la IA en esta invocación
  purpose: aiPurposeEnum('purpose').notNull(),
  // Qué modelo de Claude se usó (ej: 'claude-haiku-4-5-20251001')
  model: text('model').notNull(),
  // Qué prompt (versión) se usó como base (puede ser null si no hay prompt en DB)
  prompt_id: uuid('prompt_id').references(() => prompts.id, { onDelete: 'restrict' }),
  // Los mensajes completos que se enviaron a la API (para reproducir la llamada si es necesario)
  input_messages: jsonb('input_messages').notNull(),
  // Texto completo que devolvió la IA
  output_text: text('output_text'),
  // Respuesta parseada como JSON (si la IA devolvió JSON estructurado)
  output_parsed: jsonb('output_parsed'),
  // Conteo de tokens usados (para calcular el costo)
  input_tokens: integer('input_tokens').notNull(),
  output_tokens: integer('output_tokens').notNull(),
  // Tokens leídos desde el caché de prompts de Claude (se cobra menos)
  cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
  // Costo total en dólares de esta invocación
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
  // Tiempo de respuesta en milisegundos
  latency_ms: integer('latency_ms').notNull(),
  // Si la llamada fue exitosa o falló
  success: boolean('success').notNull(),
  // Mensaje de error si falló
  error: text('error'),
  // Quién o qué disparó esta llamada
  triggered_by: aiTriggeredByEnum('triggered_by').notNull(),
  // Referencias opcionales para saber a qué reporte o ciclo corresponde esta invocación
  related_report_id: uuid('related_report_id').references(() => reports.id, { onDelete: 'restrict' }),
  related_cycle_id: uuid('related_cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type AiInvocation = typeof aiInvocations.$inferSelect;
export type NewAiInvocation = typeof aiInvocations.$inferInsert;
