// Notifica a los usuarios con rol executive y press_admin cuando un secretario
// somete una propuesta de evento institucional (status='proposed').
//
// Envía el aviso con botones de aprobación/rechazo. Como los exec pueden no tener
// ventana de 24h activa, se usa sendWhatsAppTemplate con fallback al panel.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatDateShort(date: Date, allDay: boolean): string {
  const datePart = date.toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    weekday: 'long',
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

interface ProposalEvent {
  id: string;
  title: string;
  type: string;
  starts_at: Date;
  all_day: boolean;
  location: string | null;
}

export async function notifyProposal(event: ProposalEvent, creatorName: string): Promise<void> {
  const reviewers = await db
    .select({ id: schema.users.id, phone_e164: schema.users.phone_e164 })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.is_active, true),
        isNull(schema.users.deleted_at),
        inArray(schema.users.role, ['executive', 'press_admin'] as const),
      ),
    );

  if (reviewers.length === 0) return;

  const typeLabel = event.type === 'mobilization' ? 'evento presencial' : 'evento online';
  const dateStr = formatDateShort(event.starts_at, event.all_day);
  const locLine = event.location ? `\n📍 ${event.location}` : '';

  const fallback =
    `📋 *Nueva propuesta de ${typeLabel}*\n\n` +
    `*${event.title}*\n📅 ${dateStr}${locLine}\n` +
    `_Propuesto por ${creatorName}_\n\n` +
    `Aprobá o rechazá desde el panel:\n` +
    `👉 panel.atepsa.org.ar/agenda/propuestas`;

  let sent = 0;
  for (const r of reviewers) {
    await sendWhatsAppTemplate(
      r.phone_e164,
      'agenda_proposal_approval',
      {
        title: event.title,
        date: dateStr,
        creator: creatorName,
        approve_id: `approve_proposal:${event.id}`,
        reject_id: `reject_proposal:${event.id}`,
      },
      fallback,
    ).catch(err =>
      logger.warn({ err, eventId: event.id, phone: r.phone_e164 }, 'notifyProposal: fallo al enviar (no fatal)'),
    );
    sent++;
  }

  logger.info({ eventId: event.id, sent }, 'notifyProposal: avisos enviados a revisores');
}
