// POST /api/agenda/events/[id]/reject
// Rechaza una propuesta de evento (status: proposed → cancelled).
// Solo lo pueden ejecutar executive y press_admin.
// Notifica al creador por WhatsApp.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: userId, role } = session.user;
  if (role !== 'press_admin' && role !== 'executive') {
    return NextResponse.json({ error: 'Solo executive o press_admin pueden rechazar propuestas' }, { status: 403 });
  }

  const eventId = params.id;
  const body = await req.json() as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { id: true, title: true, status: true, created_by: true },
  });

  if (!event) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });
  if (event.status !== 'proposed') {
    return NextResponse.json({ error: 'Solo se pueden rechazar eventos en estado propuesto' }, { status: 400 });
  }

  await db.update(schema.events).set({
    status: 'cancelled',
    cancelled_by: userId,
    cancelled_at: new Date(),
    cancellation_reason: reason ?? 'Propuesta rechazada por la Mesa Ejecutiva.',
    updated_at: new Date(),
  }).where(eq(schema.events.id, eventId));

  // Notificar al creador
  const creator = await db.query.users.findFirst({
    where: eq(schema.users.id, event.created_by),
    columns: { phone_e164: true },
  });

  if (creator) {
    const reasonLine = reason ? `\nMotivo: ${reason}` : '';
    await sendWhatsAppText(
      creator.phone_e164,
      `❌ Tu propuesta para *${event.title}* fue rechazada por la Mesa Ejecutiva.${reasonLine}`,
    ).catch(err => logger.warn({ err, eventId }, 'reject: fallo al notificar al creador (no fatal)'));
  }

  logger.info({ eventId, rejectedBy: userId, reason }, 'evento propuesto rechazado');
  return NextResponse.json({ ok: true });
}
