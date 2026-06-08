// Hook central del módulo Agenda.
// Llamar cada vez que un evento transiciona a status='confirmed'.
//
// Responsabilidades:
//   1. Para secretariat/mobilization: generar event_attendees + enviar convocatoria por WhatsApp
//   2. Para todos los tipos: programar notificaciones (recordatorios + followup) en event_notifications
//
// Errores de WhatsApp (externos) se capturan y loguean: no son fatales.
// Errores de DB burbujean: el llamador debe manejarlos si necesita.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { isUserOnLeave } from '@/lib/dates';
import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  type InteractiveButton,
} from '@/lib/whatsapp';
import { logger } from '@/lib/logger';
import type { ReminderConfig } from '@/lib/ai/prompts/parse-event';

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatARTShort(date: Date, allDay: boolean): string {
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

function toARTDateISO(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: ART_TZ });
}

// ─────────────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  type: 'personal' | 'secretariat' | 'mobilization';
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  location: string | null;
  created_by: string;
  requires_confirmation: boolean;
  is_important: boolean;
  reminder_config: unknown;
}

export async function onEventConfirmed(eventId: string): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: {
      id: true,
      title: true,
      type: true,
      starts_at: true,
      ends_at: true,
      all_day: true,
      location: true,
      created_by: true,
      requires_confirmation: true,
      is_important: true,
      reminder_config: true,
    },
  });

  if (!event) {
    logger.warn({ eventId }, 'onEventConfirmed: evento no encontrado');
    return;
  }

  // Safe cast: type enum values match the interface
  const ev = event as EventRow;
  const isGroupEvent = ev.type === 'secretariat' || ev.type === 'mobilization';

  if (isGroupEvent) {
    await generateAttendeesAndInvite(ev);
  }

  await scheduleNotifications(ev);
}

// ─── Generación de convocados + envío de invitaciones ────────────────────────

async function generateAttendeesAndInvite(event: EventRow): Promise<void> {
  // Guardia contra doble ejecución: si ya hay convocados, saltar
  const existing = await db
    .select({ id: schema.eventAttendees.id })
    .from(schema.eventAttendees)
    .where(eq(schema.eventAttendees.event_id, event.id))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ eventId: event.id }, 'onEventConfirmed: convocados ya generados, saltando');
    return;
  }

  // Todos los usuarios activos del secretariado + ejecutiva
  const activeUsers = await db
    .select({
      id: schema.users.id,
      phone_e164: schema.users.phone_e164,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.is_active, true),
        isNull(schema.users.deleted_at),
        inArray(schema.users.role, ['secretary', 'executive'] as const),
      ),
    );

  if (activeUsers.length === 0) return;

  const eventDateISO = toARTDateISO(event.starts_at);
  const dateStr = formatARTShort(event.starts_at, event.all_day);
  const locationLine = event.location ? `\n📍 ${event.location}` : '';
  const typeLabel = event.type === 'mobilization' ? 'Movilización' : 'Evento del Secretariado';

  const attendeeRows: (typeof schema.eventAttendees.$inferInsert)[] = [];
  const invitedPhones: string[] = [];

  for (const u of activeUsers) {
    const onLeave = await isUserOnLeave(u.id, eventDateISO);
    attendeeRows.push({
      id: uuidv7(),
      event_id: event.id,
      user_id: u.id,
      status: onLeave ? 'on_leave' : 'invited',
    });
    if (!onLeave) invitedPhones.push(u.phone_e164);
  }

  await db.insert(schema.eventAttendees).values(attendeeRows);

  // Enviar convocatoria a los que no están de licencia
  let sentCount = 0;
  for (const phone of invitedPhones) {
    await sendInvitation(event, phone, dateStr, locationLine, typeLabel);
    sentCount++;
  }

  logger.info(
    { eventId: event.id, total: activeUsers.length, invited: invitedPhones.length, sent: sentCount },
    'onEventConfirmed: convocados generados e invitaciones enviadas',
  );
}

async function sendInvitation(
  event: EventRow,
  phoneE164: string,
  dateStr: string,
  locationLine: string,
  typeLabel: string,
): Promise<void> {
  const bodyText = `📢 *${typeLabel}*\n\n*${event.title}*\n📅 ${dateStr}${locationLine}`;

  if (event.requires_confirmation) {
    const buttons: InteractiveButton[] = [
      { id: `attend_yes:${event.id}`, title: '✅ Voy' },
      { id: `attend_no:${event.id}`, title: '❌ No puedo' },
      { id: `attend_maybe:${event.id}`, title: '🤔 Tal vez' },
    ];
    await sendWhatsAppInteractive(phoneE164, bodyText, buttons).catch(err =>
      logger.warn({ err, eventId: event.id, phoneE164 }, 'onEventConfirmed: fallo al enviar invitación interactiva (no fatal)'),
    );
  } else {
    const fallback = `${bodyText}\n\n_Informativo. No requiere confirmación de asistencia._`;
    await sendWhatsAppTemplate(
      phoneE164,
      'agenda_invitation',
      { title: event.title, date: dateStr, location: event.location ?? '' },
      fallback,
    ).catch(err =>
      logger.warn({ err, eventId: event.id, phoneE164 }, 'onEventConfirmed: fallo al enviar invitación (no fatal)'),
    );
  }
}

// ─── Programación de notificaciones ─────────────────────────────────────────

type ReminderEntry = [keyof ReminderConfig, typeof schema.eventNotifications.$inferInsert['kind'], number];

const REMINDER_OFFSETS: ReminderEntry[] = [
  ['7d',  'reminder_7d',  7 * 24 * 60 * 60 * 1000],
  ['24h', 'reminder_24h', 24 * 60 * 60 * 1000],
  ['12h', 'reminder_12h', 12 * 60 * 60 * 1000],
  ['2h',  'reminder_2h',  2  * 60 * 60 * 1000],
];

async function scheduleNotifications(event: EventRow): Promise<void> {
  const remConf = event.reminder_config as ReminderConfig | null;
  if (!remConf) return;

  // Guardia contra doble ejecución
  const existing = await db
    .select({ id: schema.eventNotifications.id })
    .from(schema.eventNotifications)
    .where(eq(schema.eventNotifications.event_id, event.id))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ eventId: event.id }, 'onEventConfirmed: notificaciones ya programadas, saltando');
    return;
  }

  const now = new Date();
  const isGroupEvent = event.type === 'secretariat' || event.type === 'mobilization';

  // Destinatarios: convocados (sin on_leave) para eventos grupales, creador para personal
  let recipientIds: string[];
  if (isGroupEvent) {
    const attendees = await db
      .select({ user_id: schema.eventAttendees.user_id })
      .from(schema.eventAttendees)
      .where(
        and(
          eq(schema.eventAttendees.event_id, event.id),
          eq(schema.eventAttendees.status, 'invited'),
        ),
      );
    recipientIds = attendees.map(a => a.user_id);
  } else {
    recipientIds = [event.created_by];
  }

  if (recipientIds.length === 0) return;

  const notifications: (typeof schema.eventNotifications.$inferInsert)[] = [];

  for (const userId of recipientIds) {
    for (const [configKey, kind, offsetMs] of REMINDER_OFFSETS) {
      if (!remConf[configKey]) continue;
      const scheduledFor = new Date(event.starts_at.getTime() - offsetMs);
      if (scheduledFor <= now) continue; // ya pasó
      notifications.push({
        id: uuidv7(),
        event_id: event.id,
        user_id: userId,
        kind,
        scheduled_for: scheduledFor,
      });
    }

    // Followup: solo al creador, ~24h después del evento
    if (remConf.followup && userId === event.created_by) {
      const followupAt = new Date(event.starts_at.getTime() + 24 * 60 * 60 * 1000);
      if (followupAt > now) {
        notifications.push({
          id: uuidv7(),
          event_id: event.id,
          user_id: userId,
          kind: 'followup',
          scheduled_for: followupAt,
        });
      }
    }
  }

  if (notifications.length === 0) return;

  await db.insert(schema.eventNotifications).values(notifications);

  logger.info(
    { eventId: event.id, count: notifications.length, recipients: recipientIds.length },
    'onEventConfirmed: notificaciones programadas',
  );
}
