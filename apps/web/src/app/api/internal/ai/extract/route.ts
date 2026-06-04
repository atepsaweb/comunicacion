// Endpoint de extracción de reporte: el corazón del flujo de procesamiento.
// n8n lo llama después de recibir un mensaje clasificado como 'report' o 'report_followup_reply'.
// El endpoint:
//   1. Resuelve el texto del mensaje (texto plano, transcripción de audio o extracción de documento)
//   2. Busca el contexto del reporte actual del secretario (ítems ya reportados esta semana)
//   3. Consulta el contexto de la semana anterior (para detectar continuidades)
//   4. Llama a Claude con todo ese contexto para extraer los nuevos ítems
//   5. Guarda los ítems en la base de datos, actualizando o creando el reporte
import { NextRequest, NextResponse } from 'next/server';
import { eq, and, desc, inArray, not } from 'drizzle-orm';
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
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { getAffiliatesContextBlock } from '@/lib/affiliates';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

/** Resuelve el texto del mensaje: texto plano, audio transcripto o documento extraído */
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
  if (msg.kind === 'other') {
    const docEx = await db.query.documentExtractions.findFirst({
      where: eq(schema.documentExtractions.inbound_message_id, msg.id),
      columns: { text: true },
    });
    return docEx?.text ?? null;
  }
  return msg.text_content;
}

/** Obtiene los ítems del reporte del ciclo anterior para este usuario (memoria cross-week) */
async function getPreviousWeekItems(
  userId: string,
  currentCycleId: string,
): Promise<{ title: string; category: string }[]> {
  const prevCycle = await db.query.weeklyCycles.findFirst({
    where: and(
      inArray(schema.weeklyCycles.status, ['closed', 'processed', 'published']),
      not(eq(schema.weeklyCycles.id, currentCycleId)),
    ),
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    columns: { id: true },
  });

  if (!prevCycle) return [];

  const prevReport = await db.query.reports.findFirst({
    where: and(
      eq(schema.reports.user_id, userId),
      eq(schema.reports.cycle_id, prevCycle.id),
    ),
    columns: { id: true },
  });

  if (!prevReport) return [];

  return db.query.reportItems.findMany({
    where: eq(schema.reportItems.report_id, prevReport.id),
    columns: { title: true, category: true },
  });
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
      quoted_body: true,  // Threading
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

  // Reporte existente del mismo usuario en el mismo ciclo
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

  // Memoria cross-week: ítems del ciclo anterior
  const previousWeekItems = await getPreviousWeekItems(msg.user_id, msg.cycle_id);

  const dbPrompt = await getActivePrompt('extract-report');
  const systemBlocks = dbPrompt
    ? [{ text: dbPrompt.system_prompt, cache: true }]
    : [
        { text: EXTRACT_REPORT_SYSTEM, cache: true },
        { text: EXTRACT_REPORT_FEW_SHOT, cache: true },
      ];

  // Contexto cacheable con afiliados/delegados conocidos. La IA lo usa para
  // identificar personas mencionadas por el secretario y atribuirles
  // dependencia/cargo en lugar de tirarlos como menciones sueltas.
  const affiliatesBlock = await getAffiliatesContextBlock();
  if (affiliatesBlock) {
    systemBlocks.push({ text: affiliatesBlock, cache: true });
  }

  const result = await callAI({
    purpose: 'extract',
    model: EXTRACT_REPORT_MODEL,
    systemBlocks,
    userContent: buildExtractReportPrompt({
      messageText: text,
      existingItems,
      previousWeekItems: previousWeekItems.length > 0 ? previousWeekItems : undefined,
      quotedBody: msg.quoted_body,
    }),
    relatedReportId: existingReport?.id,
    relatedCycleId: msg.cycle_id,
    promptId: dbPrompt?.id,
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
    const hasNewItems = parsed.items.length > 0;

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

    if (parsed.merge_strategy === 'replace') {
      await db
        .delete(schema.reportItems)
        .where(eq(schema.reportItems.report_id, reportId));
    }
  }

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
      hasPreviousWeekContext: previousWeekItems.length > 0,
      hasQuotedContext: !!msg.quoted_body,
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
