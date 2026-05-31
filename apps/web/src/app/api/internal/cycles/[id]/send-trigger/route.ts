import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte, not } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const TRIGGER_BASE = `*ATEPSA — Reporte semanal*

Hola, es jueves. Es el momento del reporte semanal del Secretariado Nacional.

Contame brevemente qué hiciste esta semana: reuniones, gestiones, temas laborales, novedades. Un audio de 1 o 2 minutos alcanza perfectamente.

Si esta semana no tenés novedades, respondé simplemente: "esta semana paso".`;

/** Construye el mensaje del jueves con pendientes de la semana anterior si los hay */
function buildTriggerMessage(previousItems: { title: string; category: string }[]): string {
  if (previousItems.length === 0) return TRIGGER_BASE;

  const itemList = previousItems
    .slice(0, 5) // máximo 5 para no saturar el mensaje
    .map(it => `  • ${it.title}`)
    .join('\n');

  const pendingBlock = `\n\n_La semana pasada reportaste estos temas:_\n${itemList}\n\nSi hay novedades sobre alguno de ellos, incluílo en tu reporte de esta semana.`;

  return TRIGGER_BASE + pendingBlock;
}

/** Trae los ítems del reporte del ciclo anterior para un usuario dado */
async function getPrevWeekItems(
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
    limit: 5,
  });
}

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

  const cycleStartDate = cycle.starts_at.toISOString().split('T')[0]!;
  const cycleEndDt = new Date(cycle.starts_at);
  cycleEndDt.setUTCDate(cycle.starts_at.getUTCDate() + 6);
  const cycleEndDate = cycleEndDt.toISOString().split('T')[0]!;

  const allUsers = await db.query.users.findMany({
    where: eq(schema.users.is_active, true),
    columns: { id: true, full_name: true, phone_e164: true },
  });

  const onLeaveRows = await db.query.absences.findMany({
    columns: { user_id: true },
    where: and(
      lte(schema.absences.starts_on, cycleEndDate),
      gte(schema.absences.ends_on, cycleStartDate),
    ),
  });
  const onLeaveIds = new Set(onLeaveRows.map(a => a.user_id));
  const targets = allUsers.filter(u => !onLeaveIds.has(u.id));

  let sent = 0;
  let failed = 0;
  let personalized = 0;

  for (const user of targets) {
    try {
      // Memoria cross-week: ítems del ciclo anterior personalizados por secretario
      const prevItems = await getPrevWeekItems(user.id, params.id);
      const message = buildTriggerMessage(prevItems);
      if (prevItems.length > 0) personalized++;

      await sendWhatsAppText(user.phone_e164, message);
      await db.insert(schema.outboundMessages).values({
        provider: 'waha',
        to_phone_e164: user.phone_e164,
        user_id: user.id,
        cycle_id: params.id,
        purpose: 'weekly_trigger',
        body: message,
        sent_at: new Date(),
        delivery_status: 'sent',
      });
      sent++;
    } catch (err) {
      logger.error({ err, userId: user.id, cycleId: params.id }, 'send-trigger failed for user');
      failed++;
    }
  }

  logger.info({ cycleId: params.id, sent, failed, personalized, total: targets.length }, 'weekly trigger send complete');
  return NextResponse.json({ ok: true, sent, failed, personalized, total: targets.length });
}
