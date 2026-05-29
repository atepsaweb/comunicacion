import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
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
import { logger } from '@/lib/logger';

const MAX_FOLLOWUPS = 2;

type Body = { reportId: string };

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

  if (report.followup_count >= MAX_FOLLOWUPS) {
    logger.info({ reportId, followup_count: report.followup_count }, 'max followups reached');
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

  const result = await callAI({
    purpose: 'assess_completeness',
    model: ASSESS_COMPLETENESS_MODEL,
    systemBlocks: [{ text: ASSESS_COMPLETENESS_SYSTEM, cache: true }],
    userContent: buildAssessCompletenessPrompt(reportSummary),
    relatedReportId: reportId,
    relatedCycleId: report.cycle_id ?? undefined,
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
