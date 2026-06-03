// Endpoint para enviar recordatorios a los secretarios que todavía no reportaron.
// n8n lo llama el viernes al mediodía (12:00 ART) cuando el ciclo está abierto.
// El endpoint determina a quiénes enviar:
//   - Excluye a quienes ya reportaron (cualquier estado que no sea no_report)
//   - Excluye a quienes tienen ausencia registrada que cubre la semana actual
// Luego envía el mensaje de recordatorio y registra el envío en outbound_messages.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const REMINDER_MESSAGE = `*ATEPSA — Recordatorio de reporte*

Hola, todavía no recibimos tu reporte de esta semana.

Si tenés novedades, mandá un audio o texto ahora. Si esta semana no tenés, respondé "esta semana paso".

El ciclo cierra a las 18 hs.`;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, params.id),
    columns: { id: true, status: true, starts_at: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
  if (cycle.status !== 'open') {
    return NextResponse.json({ error: 'Cycle is not open', status: cycle.status }, { status: 409 });
  }

  const cycleStartDate = cycle.starts_at.toISOString().split('T')[0];
  const cycleEndDt = new Date(cycle.starts_at);
  cycleEndDt.setUTCDate(cycle.starts_at.getUTCDate() + 6);
  const cycleEndDate = cycleEndDt.toISOString().split('T')[0];

  const allUsers = await db.query.users.findMany({
    where: eq(schema.users.is_active, true),
    columns: { id: true, full_name: true, phone_e164: true },
  });

  // Exclude users on leave this cycle
  const onLeaveRows = await db.query.absences.findMany({
    columns: { user_id: true },
    where: and(
      lte(schema.absences.starts_on, cycleEndDate),
      gte(schema.absences.ends_on, cycleStartDate),
    ),
  });
  const onLeaveIds = new Set(onLeaveRows.map(a => a.user_id));

  // Exclude users who already have a report with content for this cycle
  // (draft/awaiting_followup/complete counts as "reported"; paused/on_leave also excluded)
  const reports = await db.query.reports.findMany({
    where: eq(schema.reports.cycle_id, params.id),
    columns: { user_id: true, status: true },
  });
  const hasReportIds = new Set(
    reports
      .filter(r => r.status !== 'no_report')
      .map(r => r.user_id),
  );

  const targets = allUsers.filter(u => !onLeaveIds.has(u.id) && !hasReportIds.has(u.id));

  let sent = 0;
  let failed = 0;

  for (const user of targets) {
    try {
      const result = await sendWhatsAppTemplate(
        user.phone_e164,
        'weekly_reminder',
        { firstName: user.full_name.split(/\s+/)[0] ?? user.full_name },
        REMINDER_MESSAGE,
      );
      await db.insert(schema.outboundMessages).values({
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        to_phone_e164: user.phone_e164,
        user_id: user.id,
        cycle_id: params.id,
        purpose: 'reminder',
        body: REMINDER_MESSAGE,
        sent_at: new Date(),
        delivery_status: 'sent',
      });
      sent++;
    } catch (err) {
      logger.error({ err, userId: user.id, cycleId: params.id }, 'send-reminder failed for user');
      failed++;
    }
  }

  logger.info({ cycleId: params.id, sent, failed }, 'weekly reminder send complete');
  return NextResponse.json({ ok: true, sent, failed, total: targets.length });
}
