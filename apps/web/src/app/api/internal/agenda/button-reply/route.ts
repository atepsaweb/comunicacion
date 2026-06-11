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
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';
import { onEventConfirmed } from '@/lib/agenda/on-event-confirmed';
import { sendEventConfirmation } from '@/lib/agenda/send-event-confirmation';
import { REMINDER_DEFAULTS } from '@/lib/ai/prompts/parse-event';

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
      columns: { id: true, status: true, created_by: true, title: true, starts_at: true, all_day: true, type: true },
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
      // Eventos personales siempre se confirman directamente.
      // Para events institucionales: executive/press_admin confirman; secretary propone.
      const canConfirmDirectly =
        event.type === 'personal' ||
        user.role === 'executive' ||
        user.role === 'press_admin';
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

      // Eventos institucionales sin convocados (no se mencionó a nadie en el alta):
      // preguntar a quién convocar. La respuesta la procesa parse-event vía el
      // fast-path event_attendees_request de classify-intent.
      if (event.type === 'secretariat' || event.type === 'mobilization') {
        const preCreated = await db.query.eventAttendees.findFirst({
          where: and(
            eq(schema.eventAttendees.event_id, entityId),
            ne(schema.eventAttendees.user_id, user.id),
          ),
          columns: { id: true },
        });

        if (!preCreated) {
          const askText =
            `👥 ¿A quién convoco para *${event.title}*?\n\n` +
            `Respondé con los nombres (ej: "Paola y Ricardo"), *todos* para convocar a todo el Secretariado, o *nadie*.`;
          try {
            const askResult = await sendWhatsAppText(user.phone_e164, askText);
            await db.insert(schema.outboundMessages).values({
              provider: askResult.provider,
              provider_message_id: askResult.providerMessageId,
              to_phone_e164: user.phone_e164,
              user_id: user.id,
              cycle_id: message.cycle_id ?? null,
              purpose: 'event_attendees_request',
              body: askText,
              meta: { eventId: entityId },
              sent_at: new Date(),
              delivery_status: 'sent',
            });
          } catch (err) {
            logger.warn({ err, eventId: entityId }, 'confirm_event: fallo al preguntar convocados (no fatal)');
          }
        }
      }

      if (newStatus === 'confirmed') {
        onEventConfirmed(entityId).catch(err =>
          logger.error({ err, eventId: entityId }, 'button-reply confirm_event: error en onEventConfirmed'),
        );
      }

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
      // Borrado del pending + pedido de redescripción
      await db.delete(schema.events).where(
        and(eq(schema.events.id, entityId), eq(schema.events.status, 'pending_confirmation'))
      );

      // Registrar el pedido como event_clarification: el fast-path de classify-intent
      // lo lee para enrutar la próxima respuesta del usuario a event_create aunque
      // no contenga el verbo "agendar" (ej: "voy con Paola y Ricardo").
      const editPrompt = 'De acuerdo. Contame de nuevo el evento completo: título, fecha, hora, lugar y con quién vas.';
      try {
        const sendResult = await sendWhatsAppText(user.phone_e164, editPrompt);
        await db.insert(schema.outboundMessages).values({
          provider: sendResult.provider,
          provider_message_id: sendResult.providerMessageId,
          to_phone_e164: user.phone_e164,
          user_id: user.id,
          cycle_id: message.cycle_id ?? null,
          purpose: 'event_clarification',
          body: editPrompt,
          sent_at: new Date(),
          delivery_status: 'sent',
        });
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'edit_event: fallo al enviar pedido de redescripción (no fatal)');
      }

      logger.info({ eventId: entityId, userId: user.id }, 'button-reply: evento devuelto a edición');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ eventId: entityId, status: 'editing' });
    }
  }

  // ─── Selección de tipo de evento ──────────────────────────────────────────
  // Payload: set_event_type:<eventId>:<type>
  // La entityId contiene eventId:type (el action ya se separó en el primer ':').

  if (action === 'set_event_type') {
    const lastColon = entityId.lastIndexOf(':');
    if (lastColon === -1) {
      logger.warn({ messageId, entityId }, 'button-reply: set_event_type formato inválido');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
    }

    const eventId = entityId.slice(0, lastColon);
    const newType = entityId.slice(lastColon + 1);

    if (!['personal', 'secretariat', 'mobilization'].includes(newType)) {
      logger.warn({ messageId, newType }, 'button-reply: tipo de evento inválido');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ error: 'Invalid type' }, { status: 422 });
    }

    const event = await db.query.events.findFirst({
      where: eq(schema.events.id, eventId),
      columns: { id: true, status: true, created_by: true },
    });

    if (!event || event.created_by !== user.id || event.status !== 'pending_confirmation') {
      await sendWhatsAppText(user.phone_e164, 'No encontré ese evento o ya fue procesado.').catch(() => undefined);
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ received: true, note: 'not found or already processed' });
    }

    const typedType = newType as 'personal' | 'secretariat' | 'mobilization';
    const reminderConfig = REMINDER_DEFAULTS[typedType] ?? REMINDER_DEFAULTS.personal;

    await db.update(schema.events).set({
      type: typedType,
      requires_confirmation: typedType !== 'personal',
      reminder_config: reminderConfig,
      updated_at: new Date(),
    }).where(eq(schema.events.id, eventId));

    await sendEventConfirmation(eventId, user, message.cycle_id ?? null);

    logger.info({ eventId, newType, userId: user.id }, 'button-reply: tipo seleccionado, confirmación enviada');
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ eventId, newType, confirmationSent: true });
  }

  // ─── Acciones futuras (A5, A7) — stub ─────────────────────────────────────

  if (action === 'attend_yes' || action === 'attend_no' || action === 'attend_maybe') {
    const statusMap = {
      attend_yes:   'going',
      attend_no:    'not_going',
      attend_maybe: 'maybe',
    } as const;
    const newAttendeeStatus = statusMap[action];

    const attendee = await db.query.eventAttendees.findFirst({
      where: and(
        eq(schema.eventAttendees.event_id, entityId),
        eq(schema.eventAttendees.user_id, user.id),
      ),
      columns: { id: true, status: true },
    });

    if (!attendee) {
      logger.warn({ userId: user.id, eventId: entityId, action }, 'button-reply: usuario no es convocado');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ received: true, action, note: 'no es convocado' });
    }

    if (attendee.status === 'on_leave') {
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ received: true, action, note: 'on_leave' });
    }

    await db.update(schema.eventAttendees).set({
      status: newAttendeeStatus,
      responded_at: new Date(),
      response_source: 'whatsapp',
      updated_at: new Date(),
    }).where(eq(schema.eventAttendees.id, attendee.id));

    const ackMap = {
      attend_yes:   '✅ Registré tu asistencia. ¡Hasta ahí!',
      attend_no:    '❌ Entendido, anotado como "no puede asistir".',
      attend_maybe: '🤔 Anotado como "tal vez". ¡Avisá si confirmás!',
    };
    await sendWhatsAppText(user.phone_e164, ackMap[action]).catch(() => undefined);

    logger.info({ userId: user.id, eventId: entityId, newAttendeeStatus }, 'button-reply: asistencia registrada');
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ received: true, action, newStatus: newAttendeeStatus });
  }

  if (action === 'approve_proposal' || action === 'reject_proposal') {
    if (user.role !== 'executive' && user.role !== 'press_admin') {
      logger.warn({ userId: user.id, action }, 'button-reply: usuario sin permiso para gestionar propuestas');
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
    }

    const proposal = await db.query.events.findFirst({
      where: eq(schema.events.id, entityId),
      columns: { id: true, title: true, status: true, created_by: true, starts_at: true, all_day: true },
    });

    if (!proposal || proposal.status !== 'proposed') {
      await sendWhatsAppText(user.phone_e164, 'Esa propuesta ya fue procesada o no existe.').catch(() => undefined);
      await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
      return NextResponse.json({ received: true, note: 'already processed or not found' });
    }

    const creator = await db.query.users.findFirst({
      where: eq(schema.users.id, proposal.created_by),
      columns: { phone_e164: true },
    });

    if (action === 'approve_proposal') {
      await db.update(schema.events).set({
        status: 'confirmed',
        approved_by: user.id,
        approved_at: new Date(),
        updated_at: new Date(),
      }).where(eq(schema.events.id, entityId));

      await sendWhatsAppText(user.phone_e164, `✅ Propuesta aprobada: *${proposal.title}*.`).catch(() => undefined);

      if (creator) {
        const dateStr = formatDateShort(proposal.starts_at, proposal.all_day);
        await sendWhatsAppText(creator.phone_e164, `✅ Tu propuesta *${proposal.title}* fue aprobada y agendada para el ${dateStr}.`).catch(() => undefined);
      }

      onEventConfirmed(entityId).catch(err =>
        logger.error({ err, eventId: entityId }, 'button-reply approve_proposal: error en onEventConfirmed'),
      );

      logger.info({ eventId: entityId, approvedBy: user.id }, 'button-reply: propuesta aprobada');
    } else {
      await db.update(schema.events).set({
        status: 'cancelled',
        cancelled_by: user.id,
        cancelled_at: new Date(),
        cancellation_reason: 'Propuesta rechazada por la Mesa Ejecutiva.',
        updated_at: new Date(),
      }).where(eq(schema.events.id, entityId));

      await sendWhatsAppText(user.phone_e164, `❌ Propuesta rechazada: *${proposal.title}*.`).catch(() => undefined);

      if (creator) {
        await sendWhatsAppText(creator.phone_e164, `❌ Tu propuesta para *${proposal.title}* fue rechazada por la Mesa Ejecutiva.`).catch(() => undefined);
      }

      logger.info({ eventId: entityId, rejectedBy: user.id }, 'button-reply: propuesta rechazada');
    }

    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ received: true, action, eventId: entityId });
  }

  // Acción desconocida
  logger.warn({ messageId, action, entityId }, 'button-reply: acción desconocida');
  await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 422 });
}
