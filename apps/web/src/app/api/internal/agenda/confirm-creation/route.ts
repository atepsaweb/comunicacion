// Endpoint de fallback para confirmaciones de evento recibidas como texto libre.
// Se usa cuando classify-intent devuelve 'event_confirmation_reply' pero el mensaje
// llegó como texto (el usuario escribió "sí" en lugar de presionar el botón).
//
// Flujo:
//   1. Busca el evento pending_confirmation más reciente del usuario
//   2. Determina la intención por keywords (sí/no/editar)
//   3. Delega a la misma lógica que button-reply
//
// Las respuestas por botón van directo a /agenda/button-reply (no pasan por acá).
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';
import { onEventConfirmed } from '@/lib/agenda/on-event-confirmed';

type Body = { messageId: string };

const AFFIRMATIVE = ['si', 'sí', 'dale', 'ok', 'confirmá', 'confirmar', 'vamos', 'yes', 'bueno', 'correcto', 'exacto', 'así', 'agendar', 'sisi', 'si si'];
const NEGATIVE    = ['no', 'cancelá', 'cancelar', 'cancela', 'descartar', 'descartá', 'nope', 'no quiero', 'no gracias'];
const EDIT_WORDS  = ['editar', 'edit', 'cambiar', 'cambia', 'modificar', 'modifica', 'actualizar', 'rectificar'];

function detectAction(text: string): 'confirm' | 'cancel' | 'edit' | 'unclear' {
  const normalized = text.toLowerCase().trim().replace(/[¿?¡!.,]/g, '');
  if (AFFIRMATIVE.some(w => normalized === w || normalized.startsWith(w + ' '))) return 'confirm';
  if (NEGATIVE.some(w => normalized === w || normalized.startsWith(w + ' '))) return 'cancel';
  if (EDIT_WORDS.some(w => normalized.includes(w))) return 'edit';
  return 'unclear';
}

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
    columns: { id: true, user_id: true, text_content: true, cycle_id: true },
  });
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!message.user_id) return NextResponse.json({ error: 'Message has no user' }, { status: 400 });

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, message.user_id),
    columns: { id: true, phone_e164: true, role: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Buscar el evento pending_confirmation más reciente del usuario
  const pendingEvent = await db.query.events.findFirst({
    where: and(
      eq(schema.events.created_by, user.id),
      eq(schema.events.status, 'pending_confirmation'),
    ),
    columns: { id: true, title: true, starts_at: true, all_day: true, type: true },
    orderBy: [desc(schema.events.created_at)],
  });

  if (!pendingEvent) {
    await sendWhatsAppText(
      user.phone_e164,
      'No encontré ningún evento pendiente de confirmación. Si querés agendar algo, contame el evento.',
    ).catch(() => undefined);
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ noPendingEvent: true });
  }

  const text = message.text_content ?? '';
  const action = detectAction(text);

  logger.info(
    { messageId, userId: user.id, eventId: pendingEvent.id, text, action },
    'confirm-creation: respuesta en texto detectada',
  );

  if (action === 'unclear') {
    await sendWhatsAppText(
      user.phone_e164,
      `Usá los botones de arriba para confirmar o cancelar *${pendingEvent.title}* 👆`,
    ).catch(() => undefined);
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ eventId: pendingEvent.id, action: 'unclear' });
  }

  if (action === 'confirm') {
    // Eventos personales siempre se confirman directamente.
    // Para eventos institucionales: executive/press_admin confirman; secretary propone.
    const canConfirmDirectly =
      pendingEvent.type === 'personal' ||
      user.role === 'executive' ||
      user.role === 'press_admin';
    const newStatus = canConfirmDirectly ? 'confirmed' : 'proposed';

    await db.update(schema.events).set({
      status: newStatus,
      ...(canConfirmDirectly ? { approved_by: user.id, approved_at: new Date() } : {}),
      updated_at: new Date(),
    }).where(eq(schema.events.id, pendingEvent.id));

    const dateStr = formatDateShort(pendingEvent.starts_at, pendingEvent.all_day);
    const ackText = canConfirmDirectly
      ? `✅ Listo. *${pendingEvent.title}* agendado para el ${dateStr}.`
      : `📋 Propuesta enviada a la Mesa Ejecutiva. Te avisamos cuando esté aprobada.`;

    await sendWhatsAppText(user.phone_e164, ackText).catch(() => undefined);

    if (newStatus === 'confirmed') {
      onEventConfirmed(pendingEvent.id).catch(err =>
        logger.error({ err, eventId: pendingEvent.id }, 'confirm-creation: error en onEventConfirmed'),
      );
    }

    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ eventId: pendingEvent.id, newStatus });
  }

  if (action === 'cancel') {
    await db.delete(schema.events).where(
      and(eq(schema.events.id, pendingEvent.id), eq(schema.events.status, 'pending_confirmation'))
    );
    await sendWhatsAppText(user.phone_e164, 'Descartado. Cuando quieras agendar algo, avisame.').catch(() => undefined);
    await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ eventId: pendingEvent.id, status: 'deleted' });
  }

  // action === 'edit'
  await db.delete(schema.events).where(
    and(eq(schema.events.id, pendingEvent.id), eq(schema.events.status, 'pending_confirmation'))
  );
  await sendWhatsAppText(
    user.phone_e164,
    'De acuerdo. Contame de nuevo el evento con título, fecha, hora y lugar.',
  ).catch(() => undefined);
  await db.update(schema.inboundMessages).set({ processed_at: new Date() }).where(eq(schema.inboundMessages.id, messageId));
  return NextResponse.json({ eventId: pendingEvent.id, status: 'editing' });
}
