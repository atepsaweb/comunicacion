// Endpoint para evaluar la completitud del reporte de un secretario.
// n8n lo llama después de que se extrajeron los ítems del reporte.
//
// Sobre el límite de repreguntas:
// El máximo aplica por "burst" de mensajes del usuario, no por ciclo. Un burst
// es una secuencia de mensajes sin un gap >= BURST_GAP_HOURS entre ellos. Así
// si el secretario manda algo a la mañana (recibe hasta N repreguntas) y vuelve
// a mandar a la tarde con un hueco de varias horas, el contador se "resetea"
// y puede recibir otras N repreguntas sobre lo nuevo.
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  ASSESS_COMPLETENESS_SYSTEM,
  ASSESS_COMPLETENESS_MODEL,
  buildAssessCompletenessPrompt,
  type AssessCompletenessOutput,
} from '@/lib/ai/prompts/assess-completeness';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { logger } from '@/lib/logger';

const DEFAULT_MAX_FOLLOWUPS_PER_BURST = 2;
const BURST_GAP_HOURS = 6;
const BURST_GAP_MS = BURST_GAP_HOURS * 60 * 60 * 1000;

type Body = { reportId: string };

/** Lee el setting `max_followup_per_burst` con fallback a 2. */
async function getMaxFollowupsPerBurst(): Promise<number> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, 'max_followup_per_burst'),
    columns: { value: true },
  });
  if (!row) return DEFAULT_MAX_FOLLOWUPS_PER_BURST;
  const v = row.value as unknown;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FOLLOWUPS_PER_BURST;
}

/**
 * Determina cuándo arrancó el burst actual del usuario en este ciclo.
 * Estrategia: recorre los inbounds desc por fecha y devuelve el más antiguo
 * que aún forma parte del burst (mensajes consecutivos con gap < BURST_GAP).
 */
async function getCurrentBurstStartTime(
  userId: string,
  cycleId: string,
): Promise<Date> {
  const inbounds = await db.query.inboundMessages.findMany({
    where: and(
      eq(schema.inboundMessages.user_id, userId),
      eq(schema.inboundMessages.cycle_id, cycleId),
    ),
    orderBy: [desc(schema.inboundMessages.received_at)],
    limit: 50,
    columns: { received_at: true },
  });

  if (inbounds.length === 0) return new Date(0);

  // Recorremos del más nuevo al más viejo: el inicio del burst es el último
  // mensaje cuyo siguiente (más viejo) tiene un gap >= BURST_GAP_MS.
  for (let i = 0; i < inbounds.length - 1; i++) {
    const newer = inbounds[i].received_at.getTime();
    const older = inbounds[i + 1].received_at.getTime();
    if (newer - older >= BURST_GAP_MS) {
      return inbounds[i].received_at;
    }
  }
  return inbounds[inbounds.length - 1].received_at;
}

/** Cuenta repreguntas enviadas al usuario desde el inicio del burst. */
async function countBurstFollowups(
  userId: string,
  burstStart: Date,
): Promise<number> {
  const rows = await db.query.outboundMessages.findMany({
    where: and(
      eq(schema.outboundMessages.user_id, userId),
      eq(schema.outboundMessages.purpose, 'followup_question'),
      gte(schema.outboundMessages.sent_at, burstStart),
    ),
    columns: { id: true },
  });
  return rows.length;
}

function buildReportSummary(
  items: Array<{ title: string; category: string; description_md: string }>,
  completenessScore: string | null,
): string {
  if (items.length === 0) {
    return 'El reporte no tiene ítems extraídos todavía.';
  }
  const scoreStr =
    completenessScore != null
      ? ` (completitud estimada: ${Math.round(Number(completenessScore) * 100)}%)`
      : '';
  const itemLines = items.map(
    (it) => `- [${it.category}] ${it.title}: ${it.description_md || '(sin descripción)'}`,
  );
  return `Ítems del reporte${scoreStr}:\n${itemLines.join('\n')}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { reportId } = (await req.json()) as Body;
  if (!reportId) {
    return NextResponse.json({ error: 'reportId required' }, { status: 400 });
  }

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, reportId),
    columns: {
      id: true,
      user_id: true,
      cycle_id: true,
      followup_count: true,
      completeness_score: true,
      status: true,
    },
  });

  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (!report.cycle_id || !report.user_id) {
    return NextResponse.json({
      needs_followup: false,
      reason: 'missing_cycle_or_user',
      suggested_question_topic: '',
    });
  }

  const max = await getMaxFollowupsPerBurst();
  const burstStart = await getCurrentBurstStartTime(report.user_id, report.cycle_id);
  const burstFollowups = await countBurstFollowups(report.user_id, burstStart);

  if (burstFollowups >= max) {
    logger.info(
      { reportId, burstFollowups, max, burstStart: burstStart.toISOString() },
      'max followups reached for current burst',
    );
    return NextResponse.json({
      needs_followup: false,
      reason: 'max_followups_reached',
      suggested_question_topic: '',
    });
  }

  const items = await db.query.reportItems.findMany({
    where: eq(schema.reportItems.report_id, reportId),
    columns: { title: true, category: true, description_md: true },
  });

  const reportSummary = buildReportSummary(items, report.completeness_score);

  const dbPrompt = await getActivePrompt('assess-completeness');
  const systemText = dbPrompt?.system_prompt ?? ASSESS_COMPLETENESS_SYSTEM;

  const result = await callAI({
    purpose: 'assess_completeness',
    model: ASSESS_COMPLETENESS_MODEL,
    systemBlocks: [{ text: systemText, cache: true }],
    userContent: buildAssessCompletenessPrompt(reportSummary),
    relatedReportId: reportId,
    relatedCycleId: report.cycle_id ?? undefined,
    promptId: dbPrompt?.id,
  });

  let parsed: AssessCompletenessOutput;
  try {
    parsed = parseAIJson<AssessCompletenessOutput>(result.text);
  } catch {
    logger.error({ raw: result.text, reportId }, 'assess-completeness parse error');
    return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
  }

  logger.info(
    { reportId, needs_followup: parsed.needs_followup, reason: parsed.reason },
    'completeness assessed',
  );

  return NextResponse.json({
    needs_followup: parsed.needs_followup,
    reason: parsed.reason,
    suggested_question_topic: parsed.suggested_question_topic,
  });
}
