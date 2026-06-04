/**
 * POST /api/internal/messages/:id/send-ack
 *
 * Envía un mensaje de respuesta al secretario por WhatsApp.
 * Se llama desde n8n después de procesar el mensaje:
 *   - Si no se generó repregunta de seguimiento: envía el ack.
 *   - Si hay repregunta, esa pregunta ya actúa como confirmación y este
 *     endpoint no se invoca.
 *
 * El texto varía según el intent del mensaje:
 *   - greeting: saludo personalizado + invitación a reportar
 *   - report/followup (con ítems): confirmación de que el reporte quedó actualizado
 *   - sin ítems / unknown: invitación a mandar las novedades
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
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
    columns: { id: true, user_id: true, cycle_id: true, intent: true },
  });

  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  if (!message.user_id) {
    return NextResponse.json({ ok: false, reason: 'no_user' });
  }

  const [user, cycle] = await Promise.all([
    db.query.users.findFirst({
      where: eq(schema.users.id, message.user_id),
      columns: { id: true, phone_e164: true, full_name: true },
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

  const firstName = user.full_name.split(/\s+/).pop() ?? user.full_name;

  // Contar ítems del reporte actual para este secretario/ciclo
  let itemCount = 0;
  if (message.cycle_id) {
    const report = await db.query.reports.findFirst({
      where: and(
        eq(schema.reports.user_id, message.user_id),
        eq(schema.reports.cycle_id, message.cycle_id),
      ),
      columns: { id: true },
    });
    if (report) {
      const items = await db.query.reportItems.findMany({
        where: eq(schema.reportItems.report_id, report.id),
        columns: { id: true },
      });
      itemCount = items.length;
    }
  }

  // Construir el texto de respuesta según el intent y el contexto
  const intent = message.intent;
  let ackText: string;

  if (intent === 'greeting') {
    // Saludo sin contenido: responder el saludo e invitar a reportar
    ackText = cycle
      ? `¡Hola, ${firstName}! 👋 ¿Cómo estás?\n\nCuando quieras, contame qué hiciste esta semana — reuniones, gestiones, novedades laborales. Un audio o texto está perfecto.`
      : `¡Hola, ${firstName}! 👋 Todavía no hay un ciclo de reporte abierto, pero cuando abra podés mandarme tus novedades de la semana por audio o texto.`;
  } else if (itemCount > 0) {
    // Reporte con contenido: confirmar que quedó registrado
    ackText = cycle
      ? `✓ Recibido, ${firstName}. Tu reporte de la semana ${cycle.iso_week}/${cycle.year} quedó actualizado.`
      : `✓ Recibido, ${firstName}. Tu mensaje quedó guardado.`;
  } else {
    // Sin ítems extraídos (mensaje vago, demasiado corto o fuera de contexto)
    ackText = cycle
      ? `¡Hola, ${firstName}! 👋 Tu mensaje llegó, pero no pude extraer novedades para el reporte.\n\nSi tenés algo para reportar esta semana, mandalo en un audio o texto contando brevemente qué hiciste.`
      : `¡Hola, ${firstName}! Tu mensaje llegó. No hay un ciclo activo ahora, pero cuando abra podés mandarme tus novedades.`;
  }

  try {
    const result = await sendWhatsAppText(user.phone_e164, ackText);

    await db.insert(schema.outboundMessages).values({
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      to_phone_e164: user.phone_e164,
      user_id: user.id,
      cycle_id: message.cycle_id ?? null,
      purpose: 'other',
      body: ackText,
      sent_at: new Date(),
      delivery_status: 'sent',
    });

    logger.info({ messageId: params.id, userId: user.id, intent, itemCount }, 'ack sent');
  } catch (err) {
    logger.warn({ err, messageId: params.id }, 'ack send failed (non-fatal)');
  }

  return NextResponse.json({ ok: true, text: ackText });
}
