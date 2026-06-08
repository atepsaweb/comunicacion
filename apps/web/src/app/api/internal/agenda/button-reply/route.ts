// Endpoint que procesa las respuestas a botones interactivos del módulo Agenda.
// Llamado por n8n cuando el webhook recibe un mensaje con type='interactive'
// (el usuario presionó un botón de respuesta rápida).
//
// Convención de button payload ID: "<accion>:<entityId>"
//   - confirm_event:<eventId>  → el creador confirma la creación de un evento pendiente
//   - cancel_event:<eventId>   → el creador cancela la creación (descarta el evento pending_confirmation)
//   - edit_event:<eventId>     → el creador quiere editar los datos del evento
//   - attend_yes:<eventId>     → asistirá a la convocatoria
//   - attend_no:<eventId>      → no puede asistir
//   - attend_maybe:<eventId>   → tal vez asiste
//   - approve_proposal:<eventId> → Mesa Ejecutiva aprueba una propuesta
//   - reject_proposal:<eventId>  → Mesa Ejecutiva rechaza una propuesta
//
// STUB A2: persiste el log y devuelve la acción parseada.
// La lógica de negocio real (crear/confirmar/cancelar eventos) se implementa en A3.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

type ParsedButtonPayload = {
  action: string;
  entityId: string;
};

/** Parsea "<accion>:<entityId>" → { action, entityId }. */
function parseButtonPayload(payloadId: string): ParsedButtonPayload | null {
  const separatorIdx = payloadId.indexOf(':');
  if (separatorIdx === -1) return null;
  return {
    action: payloadId.slice(0, separatorIdx),
    entityId: payloadId.slice(separatorIdx + 1),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  }

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: {
      id: true,
      text_content: true,  // = buttonPayloadId para mensajes interactive
      user_id: true,
      intent: true,
    },
  });

  if (!msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  const payloadId = msg.text_content;
  if (!payloadId) {
    logger.warn({ messageId }, 'agenda/button-reply: mensaje sin text_content (buttonPayloadId)');
    return NextResponse.json({ error: 'No button payload' }, { status: 422 });
  }

  const parsed = parseButtonPayload(payloadId);
  if (!parsed) {
    logger.warn({ messageId, payloadId }, 'agenda/button-reply: formato inválido (esperado "<accion>:<entityId>")');
    return NextResponse.json({ error: 'Invalid button payload format' }, { status: 422 });
  }

  logger.info(
    { messageId, userId: msg.user_id, action: parsed.action, entityId: parsed.entityId },
    'agenda button reply received — pendiente de implementar en A3',
  );

  // TODO A3: rutear por `parsed.action`:
  //   confirm_event / cancel_event / edit_event → updateEventStatus()
  //   attend_yes / attend_no / attend_maybe     → updateAttendance()
  //   approve_proposal / reject_proposal        → updateProposalStatus()

  return NextResponse.json({
    received: true,
    messageId,
    action: parsed.action,
    entityId: parsed.entityId,
  });
}
