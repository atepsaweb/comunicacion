// Helper que construye y envía el mensaje interactivo "¿Agendamos esto?"
// a un evento pending_confirmation.
// Lo usan tanto parse-event (flujo normal) como button-reply (tras selección de tipo).
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendWhatsAppInteractive } from '@/lib/whatsapp';

const ART_TZ = 'America/Argentina/Buenos_Aires';

const TYPE_LABELS: Record<string, string> = {
  personal:     'Personal',
  secretariat:  'Online 💻',
  mobilization: 'Presencial 📍',
};

function formatDateForMessage(date: Date, allDay: boolean): string {
  const datePart = date.toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const capitalized = datePart.charAt(0).toUpperCase() + datePart.slice(1);
  if (allDay) return capitalized;
  const timePart = date.toLocaleTimeString('es-AR', {
    timeZone: ART_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${capitalized}, ${timePart} hs`;
}

export async function sendEventConfirmation(
  eventId: string,
  user: { id: string; phone_e164: string },
  cycleId: string | null,
): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: {
      id: true, title: true, type: true,
      starts_at: true, all_day: true, location: true,
    },
  });
  if (!event) return;

  const attendeeRows = await db
    .select({ full_name: schema.users.full_name })
    .from(schema.eventAttendees)
    .leftJoin(schema.users, eq(schema.eventAttendees.user_id, schema.users.id))
    .where(and(
      eq(schema.eventAttendees.event_id, eventId),
      ne(schema.eventAttendees.user_id, user.id),
    ));

  const dateFormatted = formatDateForMessage(event.starts_at, event.all_day);
  const locationIcon = event.type === 'secretariat' ? '🔗' : '📍';
  const locationFallback = event.type === 'secretariat' ? '🔗 Sin link aún' : '📍 Sin lugar especificado';
  const locationLine = event.location ? `${locationIcon} ${event.location}` : locationFallback;
  const typeLine = `🏷 ${TYPE_LABELS[event.type] ?? event.type}`;
  const attendeesLine = attendeeRows.length > 0
    ? `\n👥 Con: ${attendeeRows.map(r => r.full_name).join(', ')} (les aviso al confirmar)`
    : '';

  const body = `*${event.title}*\n📅 ${dateFormatted}\n${locationLine}\n${typeLine}${attendeesLine}`;

  const sendResult = await sendWhatsAppInteractive(
    user.phone_e164,
    body,
    [
      { id: `confirm_event:${eventId}`, title: '✅ Sí, agendar' },
      { id: `edit_event:${eventId}`,   title: '✏️ Editar' },
      { id: `cancel_event:${eventId}`, title: '❌ Cancelar' },
    ],
    '¿Agendamos esto?',
  );

  await db.insert(schema.outboundMessages).values({
    provider: sendResult.provider,
    provider_message_id: sendResult.providerMessageId,
    to_phone_e164: user.phone_e164,
    user_id: user.id,
    cycle_id: cycleId,
    purpose: 'other',
    body,
    sent_at: new Date(),
    delivery_status: 'sent',
  });
}
