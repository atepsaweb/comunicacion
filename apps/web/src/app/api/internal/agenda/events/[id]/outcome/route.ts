// POST /api/internal/agenda/events/[id]/outcome
// Procesa la respuesta del creador al "¿cómo salió?" (followup de evento).
// n8n lo llama cuando classify-intent devuelve intent='event_outcome_reply'.
//
// Flujo:
//   1. Resuelve el texto del mensaje (admite audio transcripto)
//   2. Guarda outcome_md en el evento
//   3. Encuentra el ciclo semanal correspondiente a la fecha del evento
//   4. Crea/actualiza el reporte del creador en ese ciclo con el texto del outcome
//   5. Envía ack al creador
//   6. Devuelve { reportItemId, reportId }
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  EXTRACT_REPORT_SYSTEM,
  EXTRACT_REPORT_FEW_SHOT,
  EXTRACT_REPORT_MODEL,
  type ExtractReportOutput,
} from '@/lib/ai/prompts/extract-report';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { getISOWeekAndYear } from '@/lib/dates';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatDateART(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Resuelve el texto del mensaje: texto plano o transcripción de audio */
async function resolveText(msg: { id: string; kind: string; text_content: string | null }): Promise<string | null> {
  if (msg.kind === 'audio') {
    const tx = await db.query.transcriptions.findFirst({
      where: eq(schema.transcriptions.inbound_message_id, msg.id),
      columns: { text: true },
    });
    return tx?.text ?? null;
  }
  return msg.text_content;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const eventId = params.id;
  const { messageId } = (await req.json()) as Body;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  // 1. Cargar mensaje
  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, kind: true, text_content: true, user_id: true },
  });
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const outcomeText = await resolveText(msg);
  if (!outcomeText) return NextResponse.json({ error: 'No text in message' }, { status: 422 });

  // 2. Cargar evento
  const ev = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: {
      id: true, title: true, type: true, starts_at: true,
      created_by: true, outcome_md: true,
    },
  });
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // Idempotencia: si ya hay outcome, no reemplazamos
  if (ev.outcome_md) {
    logger.warn({ eventId, messageId }, 'outcome: evento ya tiene outcome_md — ignorando');
    await db.update(schema.inboundMessages).set({ processed_at: new Date() })
      .where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ skipped: true, reason: 'already_has_outcome' });
  }

  // 3. Cargar el teléfono del creador para el ack
  const creator = await db.query.users.findFirst({
    where: eq(schema.users.id, ev.created_by),
    columns: { phone_e164: true },
  });

  // 4. Encontrar el ciclo semanal que corresponde a la fecha del evento
  const { year, isoWeek } = getISOWeekAndYear(ev.starts_at);
  const cycle = await db.query.weeklyCycles.findFirst({
    where: and(
      eq(schema.weeklyCycles.year, year),
      eq(schema.weeklyCycles.iso_week, isoWeek),
    ),
    columns: { id: true, status: true },
  });

  // 5. Actualizar evento con el outcome
  await db.update(schema.events).set({
    outcome_md: outcomeText,
    outcome_reported_at: new Date(),
    updated_at: new Date(),
  }).where(eq(schema.events.id, eventId));

  // 6. Si hay ciclo, crear/actualizar el reporte del creador con el texto del outcome
  let reportItemId: string | null = null;
  let reportId: string | null = null;

  if (cycle) {
    const dateStr = formatDateART(ev.starts_at);
    const eventTypeLabel =
      ev.type === 'mobilization' ? 'evento presencial' :
      ev.type === 'secretariat'  ? 'evento online' : 'evento personal';

    // Prefijo de contexto para que la IA sepa que es el resultado de un evento de agenda
    const contextPrefix = `[Resultado del evento "${ev.title}" — ${eventTypeLabel} del ${dateStr}]\n\n`;
    const textForExtract = contextPrefix + outcomeText;

    // Reporte existente en ese ciclo para el creador
    const existingReport = await db.query.reports.findFirst({
      where: and(
        eq(schema.reports.user_id, ev.created_by),
        eq(schema.reports.cycle_id, cycle.id),
      ),
      columns: { id: true, status: true },
    });

    const existingItems = existingReport
      ? await db.query.reportItems.findMany({
          where: eq(schema.reportItems.report_id, existingReport.id),
          columns: { title: true, category: true },
        })
      : [];

    // Llamada a la IA con el mismo sistema que extract-report
    const dbPrompt = await getActivePrompt('extract-report');
    const systemBlocks = dbPrompt
      ? [{ text: dbPrompt.system_prompt, cache: true }]
      : [
          { text: EXTRACT_REPORT_SYSTEM, cache: true },
          { text: EXTRACT_REPORT_FEW_SHOT, cache: true },
        ];

    const aiResult = await callAI({
      purpose: 'extract',
      model: EXTRACT_REPORT_MODEL,
      systemBlocks,
      userContent: `REPORTE PREVIO ESTE CICLO:\n${
        existingItems.length > 0 ? JSON.stringify(existingItems, null, 2) : 'ninguno'
      }\n\nNUEVO MENSAJE DEL SECRETARIO:\n"${textForExtract}"\n\nEstructurá los temas de este mensaje. Es el resultado de un evento de agenda, usá merge_strategy "append".`,
      relatedReportId: existingReport?.id,
      relatedCycleId: cycle.id,
      promptId: dbPrompt?.id,
    });

    let parsed: ExtractReportOutput;
    try {
      parsed = parseAIJson<ExtractReportOutput>(aiResult.text);
    } catch {
      logger.error({ raw: aiResult.text, messageId, eventId }, 'outcome: parse error en extract-report');
      // Guardamos el outcome aunque la IA falle; el reporte se puede completar después
      parsed = { items: [], completeness_score: 0, merge_strategy: 'append' };
    }

    // Crear o actualizar el reporte
    if (!existingReport) {
      const [newReport] = await db.insert(schema.reports).values({
        user_id: ev.created_by,
        cycle_id: cycle.id,
        status: 'draft',
        completeness_score: String(parsed.completeness_score),
        first_message_at: new Date(),
        last_message_at: new Date(),
      }).returning({ id: schema.reports.id });
      reportId = newReport?.id ?? null;
    } else {
      await db.update(schema.reports).set({
        last_message_at: new Date(),
        updated_at: new Date(),
      }).where(eq(schema.reports.id, existingReport.id));
      reportId = existingReport.id;
    }

    if (reportId && parsed.items.length > 0) {
      const startIndex = parsed.merge_strategy === 'replace' ? 0 : existingItems.length;
      const inserted = await db.insert(schema.reportItems).values(
        parsed.items.map((item, i) => ({
          report_id: reportId!,
          category: item.category,
          title: item.title,
          description_md: item.description_md,
          mentions: item.mentions,
          priority: item.priority,
          is_public_safe: item.is_public_safe,
          order_index: startIndex + i,
          source_message_id: messageId,
        })),
      ).returning({ id: schema.reportItems.id });

      reportItemId = inserted[0]?.id ?? null;

      // Enlazar el primer ítem al evento
      if (reportItemId) {
        await db.update(schema.events).set({
          outcome_report_item_id: reportItemId,
          updated_at: new Date(),
        }).where(eq(schema.events.id, eventId));
      }
    }

    logger.info(
      { eventId, messageId, reportId, itemCount: parsed.items.length, cycleId: cycle.id },
      'outcome: procesado y sumado al reporte',
    );
  } else {
    // Sin ciclo para esa semana: guardamos el outcome pero no hay reporte al que sumarlo
    logger.warn({ eventId, year, isoWeek }, 'outcome: no se encontró ciclo para la semana del evento — outcome guardado sin report_item');
  }

  // 7. Marcar el mensaje como procesado
  await db.update(schema.inboundMessages).set({ processed_at: new Date() })
    .where(eq(schema.inboundMessages.id, messageId));

  // 8. Ack al creador
  if (creator) {
    const ack = reportItemId
      ? '✅ Gracias. Registré el resultado y lo sumé al reporte semanal.'
      : '✅ Gracias. Registré el resultado del evento.';
    await sendWhatsAppText(creator.phone_e164, ack).catch(err =>
      logger.warn({ err, eventId }, 'outcome: fallo al enviar ack (no fatal)'),
    );
  }

  return NextResponse.json({ reportItemId, reportId, eventId });
}
