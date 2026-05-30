/**
 * Seed inicial de la tabla `prompts` con los valores hardcodeados.
 * Correr desde apps/web: DATABASE_URL=... npx tsx scripts/seed-prompts.ts
 * Solo inserta slugs que aún no existen. Idempotente.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as schema from '../src/db/schema/index.js';
import {
  EXTRACT_REPORT_SYSTEM,
  EXTRACT_REPORT_FEW_SHOT,
  EXTRACT_REPORT_MODEL,
} from '../src/lib/ai/prompts/extract-report.js';
import {
  CLASSIFY_INTENT_SYSTEM,
  CLASSIFY_INTENT_MODEL,
} from '../src/lib/ai/prompts/classify-intent.js';
import {
  ASSESS_COMPLETENESS_SYSTEM,
  ASSESS_COMPLETENESS_MODEL,
} from '../src/lib/ai/prompts/assess-completeness.js';
import {
  FOLLOWUP_QUESTION_SYSTEM,
  FOLLOWUP_QUESTION_MODEL,
} from '../src/lib/ai/prompts/followup-question.js';
import {
  CONSOLIDATE_INTERNAL_SYSTEM,
  CONSOLIDATE_INTERNAL_MODEL,
} from '../src/lib/ai/prompts/consolidate-internal.js';
import {
  DRAFT_INSTAGRAM_SYSTEM,
  DRAFT_NEWSLETTER_SYSTEM,
  DRAFT_PUBLICATION_MODEL,
} from '../src/lib/ai/prompts/draft-publication.js';
import {
  PARSE_ABSENCE_SYSTEM,
  PARSE_ABSENCE_MODEL,
} from '../src/lib/ai/prompts/parse-absence.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const SEEDS = [
  {
    slug: 'extract-report',
    model_hint: EXTRACT_REPORT_MODEL,
    system_prompt: `${EXTRACT_REPORT_SYSTEM}\n\n${EXTRACT_REPORT_FEW_SHOT}`,
    user_template: `{prevContext}\n\nNUEVO MENSAJE DEL SECRETARIO:\n"{messageText}"\n\nEstructurá los temas de este mensaje. Si es un mensaje de seguimiento, usá merge_strategy apropiado.`,
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'classify-intent',
    model_hint: CLASSIFY_INTENT_MODEL,
    system_prompt: CLASSIFY_INTENT_SYSTEM,
    user_template: 'Clasificá este mensaje de un secretario gremial:{context}\n\n"{messageText}"',
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'assess-completeness',
    model_hint: ASSESS_COMPLETENESS_MODEL,
    system_prompt: ASSESS_COMPLETENESS_SYSTEM,
    user_template: 'Evaluá este reporte semanal:\n\n{reportSummary}',
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'followup-question',
    model_hint: FOLLOWUP_QUESTION_MODEL,
    system_prompt: FOLLOWUP_QUESTION_SYSTEM,
    user_template: 'Reporte del secretario:\n{reportSummary}\n\nTema sobre el que preguntar: {topic}',
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'consolidate-internal',
    model_hint: CONSOLIDATE_INTERNAL_MODEL,
    system_prompt: CONSOLIDATE_INTERNAL_SYSTEM,
    user_template: `CICLO: Semana {isoWeek}/{year} · {startsAt} al {endsAt}\n\nMÉTRICAS:\n- Secretarios activos: {totalActive}\n- Reportaron: {reported}\n- Con licencia: {onLeave}\n- En pausa: {paused}\n- Sin reporte: {noReport}\n{noReportSection}\n\nREPORTES RECIBIDOS:\n\n{reportsSection}`,
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'draft-social',
    model_hint: DRAFT_PUBLICATION_MODEL,
    system_prompt: `=== INSTAGRAM ===\n${DRAFT_INSTAGRAM_SYSTEM}`,
    user_template: `SEMANA: {isoWeek}/{year}\n\nCONSOLIDADO INTERNO (referencia):\n{consolidationMd}\n\nÍTEMS PÚBLICOS DISPONIBLES (is_public_safe=true):\n{itemsText}\n\nGenerá el JSON para {kind} con los campos correspondientes.`,
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'draft-newsletter',
    model_hint: DRAFT_PUBLICATION_MODEL,
    system_prompt: DRAFT_NEWSLETTER_SYSTEM,
    user_template: `SEMANA: {isoWeek}/{year}\n\nCONSOLIDADO INTERNO (referencia):\n{consolidationMd}\n\nÍTEMS PÚBLICOS DISPONIBLES (is_public_safe=true):\n{itemsText}\n\nGenerá el newsletter en markdown.`,
    notes: 'Versión inicial desde código',
  },
  {
    slug: 'parse-absence',
    model_hint: PARSE_ABSENCE_MODEL,
    system_prompt: PARSE_ABSENCE_SYSTEM,
    user_template: 'Fecha actual: {today}\nLunes de la semana actual: {weekMonday}\nDomingo de la semana actual: {weekSunday}\n\nMensaje del secretario:\n"{messageText}"',
    notes: 'Versión inicial desde código',
  },
];

async function main() {
  console.log('Iniciando seed de prompts...');

  for (const seed of SEEDS) {
    const existing = await db.query.prompts.findFirst({
      where: eq(schema.prompts.slug, seed.slug),
      columns: { id: true, slug: true },
    });

    if (existing) {
      console.log(`  ⏭  ${seed.slug} — ya existe, omitiendo`);
      continue;
    }

    await db.insert(schema.prompts).values({
      id: uuidv7(),
      slug: seed.slug,
      version: 1,
      model_hint: seed.model_hint,
      system_prompt: seed.system_prompt,
      user_template: seed.user_template,
      output_schema: null,
      is_active: true,
      created_by: null,
      notes: seed.notes,
    });

    console.log(`  ✓  ${seed.slug} — creado v1`);
  }

  console.log('Seed completado.');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
