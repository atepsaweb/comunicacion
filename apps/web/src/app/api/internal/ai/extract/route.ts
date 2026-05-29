import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  EXTRACT_REPORT_SYSTEM,
  EXTRACT_REPORT_FEW_SHOT,
  EXTRACT_REPORT_MODEL,
  buildExtractReportPrompt,
  type ExtractReportOutput,
} from '@/lib/ai/prompts/extract-report';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

async function resolveMessageText(
  msg: { id: string; kind: string; text_content: string | null },
): Promise<string | null> {
  if (msg.kind === 'audio') {
    const tx = await db.query.transcriptions.findFirst({
      where: eq(schema.transcriptions.inbound_message_id, msg.id),
      columns: { text: true },
    });
    return tx?.text ?? null;
  }
  return msg.text_content;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  }

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: {
      id: true,
      kind: true,
      text_content: true,
      user_id: true,
      cycle_id: true,
      intent: true,
    },
  });

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!msg.user_id || !msg.cycle_id) {
    return NextResponse.json({ skipped: true, reason: 'no_user_or_cycle' });
  }

  // Solo extraemos si el mensaje es un reporte o una respuesta de seguimiento
  if (msg.intent === 'absence_request' || msg.intent === 'weekly_pause' || msg.intent === 'unknown') {
    return NextResponse.json({ skipped: true, reason: 'intent_not_report', intent: msg.intent });
  }

  const text = await resolveMessageText(msg);
  if (!text) {
    return NextResponse.json({ error: 'No text to extract' }, { status: 422 });
  }

  const isFollowupReply = msg.intent === 'report_followup_reply';

  // Buscar reporte existente del mismo usuario en el mismo ciclo
  const existingReport = await db.query.reports.findFirst({
    where: and(
      eq(schema.reports.user_id, msg.user_id),
      eq(schema.reports.cycle_id, msg.cycle_id),
    ),
    columns: { id: true, completeness_score: true, status: true },
  });

  const existingItems = existingReport
    ? await db.query.reportItems.findMany({
        where: eq(schema.reportItems.report_id, existingReport.id),
        columns: { title: true, category: true },
      })
    : [];

  const result = await callAI({
    purpose: 'extract',
    model: EXTRACT_REPORT_MODEL,
    systemBlocks: [
      { text: EXTRACT_REPORT_SYSTEM, cache: true },
      { text: EXTRACT_REPORT_FEW_SHOT, cache: true },
    ],
    userContent: buildExtractReportPrompt({ messageText: text, existingItems }),
    relatedReportId: existingReport?.id,
    relatedCycleId: msg.cycle_id,
  });

  let parsed: ExtractReportOutput;
  try {
    parsed = parseAIJson<ExtractReportOutput>(result.text);
  } catch {
    logger.error({ raw: result.text, messageId }, 'extract-report parse error');
    return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
  }

  // Crear o actualizar el report
  let reportId = existingReport?.id;

  if (!reportId) {
    const [newReport] = await db
      .insert(schema.reports)
      .values({
        user_id: msg.user_id,
        cycle_id: msg.cycle_id,
        status: 'draft',
        completeness_score: String(parsed.completeness_score),
        first_message_at: new Date(),
        last_message_at: new Date(),
      })
      .returning({ id: schema.reports.id });
    reportId = newReport.id;
  } else {
    // No pisar el score si la IA no extrajo nada nuevo (el mensaje era contexto, no contenido)
    const hasNewItems = parsed.items.length > 0;

    // Si era una respuesta de seguimiento, volver el status a draft
    const statusUpdate =
      isFollowupReply && existingReport?.status === 'awaiting_followup'
        ? { status: 'draft' as const }
        : {};

    await db
      .update(schema.reports)
      .set({
        ...(hasNewItems ? { completeness_score: String(parsed.completeness_score) } : {}),
        ...statusUpdate,
        last_message_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(schema.reports.id, reportId));

    // Si merge_strategy es "replace", eliminar items existentes
    if (parsed.merge_strategy === 'replace') {
      await db
        .delete(schema.reportItems)
        .where(eq(schema.reportItems.report_id, reportId));
    }
  }

  // Insertar los nuevos items
  if (parsed.items.length > 0) {
    const startIndex = parsed.merge_strategy === 'replace' ? 0 : existingItems.length;

    await db.insert(schema.reportItems).values(
      parsed.items.map((item, i) => ({
        report_id: reportId!,
        category: item.category,
        title: item.title,
        description_md: item.description_md,
        mentions: item.mentions,
        priority: item.priority,
        is_public_safe: item.is_public_safe,
        order_index: startIndex + i,
      })),
    );
  }

  // Actualizar el invocationId con el reportId (para trazabilidad)
  await db
    .update(schema.aiInvocations)
    .set({ related_report_id: reportId, output_parsed: parsed as unknown as Record<string, unknown> })
    .where(eq(schema.aiInvocations.id, result.invocationId));

  logger.info(
    {
      messageId,
      reportId,
      itemCount: parsed.items.length,
      completeness_score: parsed.completeness_score,
      merge_strategy: parsed.merge_strategy,
    },
    'report extracted',
  );

  return NextResponse.json({
    reportId,
    completenessScore: parsed.completeness_score,
    itemCount: parsed.items.length,
    mergeStrategy: parsed.merge_strategy,
  });
}
