/**
 * POST /api/internal/messages/:id/send-ack
 *
 * Envía una confirmación de recepción al secretario por WhatsApp.
 * Se llama desde n8n después de que el reporte fue procesado y
 * no se generó repregunta de seguimiento.
 *
 * Si hay repregunta, esa misma pregunta ya actúa como confirmación.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

interface Props {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Props): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const message = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, params.id),
    columns: { id: true, user_id: true, cycle_id: true },
  });

  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  if (!message.user_id) {
    // Mensaje sin usuario registrado — ya fue manejado antes, no hay a quién responder
    return NextResponse.json({ ok: false, reason: 'no_user' });
  }

  const [user, cycle] = await Promise.all([
    db.query.users.findFirst({
      where: eq(schema.users.id, message.user_id),
      columns: { id: true, phone_e164: true },
    }),
    message.cycle_id
      ? db.query.weeklyCycles.findFirst({
          where: eq(schema.weeklyCycles.id, message.cycle_id),
          columns: { iso_week: true, year: true },
        })
      : Promise.resolve(null),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const ackText = cycle
    ? `✓ Recibido. Tu reporte de la semana ${cycle.iso_week}/${cycle.year} quedó actualizado.`
    : '✓ Recibido. No hay un ciclo activo en este momento — tu mensaje quedó guardado para cuando abra la próxima semana.';

  try {
    await sendWhatsAppText(user.phone_e164, ackText);

    // Registro en outbound para historial
    await db.insert(schema.outboundMessages).values({
      provider: 'waha',
      to_phone_e164: user.phone_e164,
      user_id: user.id,
      cycle_id: message.cycle_id ?? null,
      purpose: 'other',
      body: ackText,
      sent_at: new Date(),
      delivery_status: 'sent',
    });

    logger.info({ messageId: params.id, userId: user.id }, 'ack sent');
  } catch (err) {
    // No fatal — si falla el ack el reporte ya fue procesado igual
    logger.warn({ err, messageId: params.id }, 'ack send failed (non-fatal)');
  }

  return NextResponse.json({ ok: true, text: ackText });
}
