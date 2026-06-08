// Endpoint para procesar respuestas a botones interactivos del módulo Agenda.
// n8n lo llama cuando el inbound tiene isButtonReply=true.
//
// Convención de button payload ID: "<accion>:<entityId>"
//
// Acciones implementadas (A3):
//   confirm_event:<eventId>  → confirmar creación de evento (pending_confirmation → confirmed/proposed)
//   cancel_event:<eventId>   → descartar evento pending_confirmation
//   edit_event:<eventId>     → descartar y pedir redescripción
//
// Acciones futuras (A5, A7):
//   attend_yes/no/maybe:<eventId>   → respuesta a convocatoria
//   approve_proposal/reject_proposal:<eventId> → aprobación de Mesa Ejecutiva
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatDateShort(date: Date, allDay: boolean): string {
  const datePart = date.toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    day: 'numeric',
    month: 'long',
  });
  if (allDay) return datePart;
  const timePart = date.toLocaleTimeString('es-AR', {
    timeZone: ART_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} a las ${timePart} hs`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  const message = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, text_content: true, user_id: true, cycle_id: true },
  });
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!message.user_id) return NextResponse.json({ error: 'Message has no user' }, { status: 400 });

  // text_content = buttonPayloadId = "<accion>:<entityId>"
  const payloadId = message.text_content ?? '';
  const separatorIdx = payloadId.indexOf(':');
  if (separatorIdx === -1) {
    logger.warn({ messageId, payloadId }, 'button-reply: formato inválido');
    return NextResponse.json({ error: 'Invalid button payload format' }, { status: 422 });
  }
  const action = payloadId.slice(0, separatorIdx);
  const entityId = payloadId.slice(separatorIdx + 1);

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, message.user_id),
    columns: { id: true, phone_e164: true, role: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  logger.info({ messageId, userId: user.id, action, entityId }, 'button-reply: procesando acción');

  // ─── Acciones de confirmación de evento (A3) ──────────────────────────────

  if (action === 'confirm_event' || action === 'cancel_event' || action === 'edit_event') {
    const event = await db.query.events.findFirst({
      where: eq(schema.events.id, entityId),
      columns: { id: true, status: true, created_by: true, title: true, starts_at: true, all_day: true },
    });

    if (!event) {
      await sendWhatsAppText(user.phone_e164, 'No encontré ese evento. Puede que ya haya sido procesado.').catch(() => undefined);
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Solo el creador puede responder a su propia confirmación
    if (event.created_by !== user.id) {
      logger.warn({ userId: user.id, eventCreatedBy: event.created_by, eventId: entityId }, 'button-reply: intento de confirmar evento ajeno');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (event.status !== 'pending_confirmation') {
      // El evento ya fue procesado (ej: el usuario presionó el botón dos veces)
      await sendWhatsAppText(user.phone_e164, 'Ese evento ya fue procesado anteriormente.').catch(() => undefined);
      return NextResponse.json({ eventId: entityId, alreadyProcessed: true });
    }

    if (action === 'confirm_event') {
      // executive y press_admin confirman directamente; secretary propone para aprobación
      const canConfirmDirectly = user.role === 'executive' || user.role === 'press_admin';
      const newStatus = canConfirmDirectly ? 'confirmed' : 'proposed';

      await db.update(schema.events).set({
        status: newStatus,
        ...(canConfirmDirectly ? { approved_by: user.id, approved_at: new Date() } : {}),
        updated_at: new Date(),
      }).where(eq(schema.events.id, entityId));

      const dateStr = formatDateShort(event.starts_at, event.all_day);
      const ackText = canConfirmDirectly
        ? `✅ Listo. *${event.title}* agendado para el ${dateStr}.`
        : `📋 Propuesta enviada a la Mesa Ejecutiva. Te avisamos cuando esté aprobada.`;

      await sendWhatsAppText(user.phone_e164, ackText).catch(err =>
        logger.warn({ err, userId: user.id }, 'confirm_event: fallo al enviar ack (no fatal)')
      );

      logger.info({ eventId: entityId, newStatus, userId: user.id }, 'button-reply: evento confirmado');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ eventId: entityId, newStatus });
    }

    if (action === 'cancel_event') {
      // Borrado físico: el evento nunca fue confirmado, no hay consecuencias
      await db.delete(schema.events).where(
        and(eq(schema.events.id, entityId), eq(schema.events.status, 'pending_confirmation'))
      );
      await sendWhatsAppText(user.phone_e164, 'Descartado. Cuando quieras agendar algo, avisame.').catch(() => undefined);

      logger.info({ eventId: entityId, userId: user.id }, 'button-reply: evento cancelado y borrado');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ eventId: entityId, status: 'deleted' });
    }

    if (action === 'edit_event') {
      // Borrado del pending + pedido de redescripción; el próximo mensaje del usuario
      // se clasificará como event_create y disparará parse-event de nuevo
      await db.delete(schema.events).where(
        and(eq(schema.events.id, entityId), eq(schema.events.status, 'pending_confirmation'))
      );
      await sendWhatsAppText(user.phone_e164, 'De acuerdo. Contame de nuevo el evento con título, fecha, hora y lugar.').catch(() => undefined);

      logger.info({ eventId: entityId, userId: user.id }, 'button-reply: evento devuelto a edición');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ eventId: entityId, status: 'editing' });
    }
  }

  // ─── Acciones futuras (A5, A7) — stub ─────────────────────────────────────

  if (action === 'attend_yes' || action === 'attend_no' || action === 'attend_maybe') {
    // TODO A5: updateAttendance(entityId, user.id, action)
    logger.info({ messageId, userId: user.id, action, entityId }, 'button-reply: asistencia — pendiente de implementar en A5');
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ received: true, action, entityId, note: 'pendiente A5' });
  }

  if (action === 'approve_proposal' || action === 'reject_proposal') {
    // TODO A7: updateProposalStatus(entityId, user.id, action)
    logger.info({ messageId, userId: user.id, action, entityId }, 'button-reply: propuesta — pendiente de implementar en A7');
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ received: true, action, entityId, note: 'pendiente A7' });
  }

  // Acción desconocida
  logger.warn({ messageId, action, entityId }, 'button-reply: acción desconocida');
  await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 422 });
}
