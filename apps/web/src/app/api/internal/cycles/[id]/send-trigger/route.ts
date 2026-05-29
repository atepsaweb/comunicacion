import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const TRIGGER_MESSAGE = `*ATEPSA — Reporte semanal*

Hola, es jueves. Es el momento del reporte semanal del Secretariado Nacional.

Contame brevemente qué hiciste esta semana: reuniones, gestiones, temas laborales, novedades. Un audio de 1 o 2 minutos alcanza perfectamente.

Si esta semana no tenés novedades, respondé simplemente: "esta semana paso".`;

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

  for (const user of targets) {
    try {
      await sendWhatsAppText(user.phone_e164, TRIGGER_MESSAGE);
      await db.insert(schema.outboundMessages).values({
        provider: 'waha',
        to_phone_e164: user.phone_e164,
        user_id: user.id,
        cycle_id: params.id,
        purpose: 'weekly_trigger',
        body: TRIGGER_MESSAGE,
        sent_at: new Date(),
        delivery_status: 'sent',
      });
      sent++;
    } catch (err) {
      logger.error({ err, userId: user.id, cycleId: params.id }, 'send-trigger failed for user');
      failed++;
    }
  }

  logger.info({ cycleId: params.id, sent, failed }, 'weekly trigger send complete');
  return NextResponse.json({ ok: true, sent, failed, total: targets.length });
}
