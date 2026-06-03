// Endpoint para procesar un mensaje de ausencia recibido por WhatsApp.
// n8n lo llama cuando clasifica un mensaje con intent 'absence_request' o 'weekly_pause'.
// El proceso:
//   1. Obtiene el texto del mensaje (o lo transcribe si es audio)
//   2. Llama a Claude para parsear las fechas y el tipo de ausencia
//   3. Crea el registro de ausencia en la base de datos
//   4. Actualiza el reporte del ciclo con el estado correspondiente (paused/on_leave)
//   5. Envía una confirmación por WhatsApp al secretario
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  PARSE_ABSENCE_SYSTEM,
  PARSE_ABSENCE_MODEL,
  buildParseAbsencePrompt,
  type ParseAbsenceOutput,
} from '@/lib/ai/prompts/parse-absence';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

// Returns YYYY-MM-DD for a given UTC date offset by N days
function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

type Body = { messageId: string };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  const message = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, user_id: true, cycle_id: true, text_content: true },
  });

  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!message.user_id) return NextResponse.json({ error: 'Message has no user' }, { status: 400 });

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, message.user_id),
    columns: { id: true, phone_e164: true, full_name: true },
  });

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Resolve message text (text_content or transcription)
  let text = message.text_content ?? '';
  if (!text) {
    const transcription = await db.query.transcriptions.findFirst({
      where: eq(schema.transcriptions.inbound_message_id, messageId),
      columns: { text: true },
    });
    text = transcription?.text ?? '';
  }

  if (!text) return NextResponse.json({ error: 'No text content to parse' }, { status: 400 });

  // ART now for date context
  const nowUTC = new Date();
  const today = nowUTC.toISOString().split('T')[0];
  // Monday of current week (UTC-based, good enough for date context)
  const nowDay = nowUTC.getUTCDay() || 7; // 1=Mon..7=Sun
  const mondayUTC = new Date(nowUTC);
  mondayUTC.setUTCDate(nowUTC.getUTCDate() - (nowDay - 1));
  const weekMonday = mondayUTC.toISOString().split('T')[0];
  const weekSunday = addDays(mondayUTC, 6);

  const dbPrompt = await getActivePrompt('parse-absence');
  const systemText = dbPrompt?.system_prompt ?? PARSE_ABSENCE_SYSTEM;

  const aiResult = await callAI({
    purpose: 'other',
    model: PARSE_ABSENCE_MODEL,
    systemBlocks: [{ text: systemText, cache: true }],
    userContent: buildParseAbsencePrompt(text, today, weekMonday, weekSunday),
    triggeredBy: 'workflow',
    relatedCycleId: message.cycle_id ?? undefined,
    promptId: dbPrompt?.id,
  });

  const parsed = parseAIJson<ParseAbsenceOutput>(aiResult.text);

  const absenceType = parsed.type;
  const startsOn = parsed.starts_on ?? weekMonday;
  const endsOn = parsed.ends_on ?? weekSunday;

  // Create absence record
  const [absence] = await db
    .insert(schema.absences)
    .values({
      user_id: message.user_id,
      type: absenceType,
      starts_on: startsOn,
      ends_on: endsOn,
      reason: parsed.reason ?? null,
      source: 'whatsapp',
      registered_by: null,
    })
    .returning({ id: schema.absences.id });

  // Mark report for this cycle with appropriate status (paused or on_leave)
  if (message.cycle_id) {
    const reportStatus = absenceType === 'weekly_pause' ? 'paused' : 'on_leave';
    const existingReport = await db.query.reports.findFirst({
      where: eq(schema.reports.cycle_id, message.cycle_id),
      columns: { id: true },
    });
    if (existingReport) {
      await db
        .update(schema.reports)
        .set({ status: reportStatus, updated_at: new Date() })
        .where(eq(schema.reports.id, existingReport.id));
    } else {
      await db.insert(schema.reports).values({
        user_id: message.user_id,
        cycle_id: message.cycle_id,
        status: reportStatus,
        completeness_score: '0',
        followup_count: 0,
        first_message_at: new Date(),
        last_message_at: new Date(),
      });
    }
  }

  // Mark message as processed
  await db
    .update(schema.inboundMessages)
    .set({ processed_at: new Date() })
    .where(eq(schema.inboundMessages.id, messageId));

  // Send confirmation via WhatsApp
  const firstName = user.full_name.split(/\s+/)[0] ?? user.full_name;
  const confirmText =
    absenceType === 'weekly_pause'
      ? `Registré tu pausa, ${firstName}. No voy a enviarte recordatorios esta semana.`
      : `Registré tu ausencia del ${startsOn} al ${endsOn}${parsed.reason ? ` (${parsed.reason})` : ''}. Quedás excluido/a de los recordatorios en ese período.`;

  try {
    const result = await sendWhatsAppText(user.phone_e164, confirmText);
    await db.insert(schema.outboundMessages).values({
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      to_phone_e164: user.phone_e164,
      user_id: user.id,
      cycle_id: message.cycle_id ?? null,
      purpose: 'other',
      body: confirmText,
      sent_at: new Date(),
      delivery_status: 'sent',
    });
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'absence confirmation send failed (non-fatal)');
  }

  return NextResponse.json({ absenceId: absence.id, type: absenceType, startsOn, endsOn });
}
