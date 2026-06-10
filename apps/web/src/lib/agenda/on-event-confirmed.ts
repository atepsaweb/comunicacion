// Hook central del módulo Agenda.
// Llamar cada vez que un evento transiciona a status='confirmed'.
//
// Responsabilidades (modelo 2026-06-09: convocatoria dirigida, no masiva):
//   1. Asegurar la fila del creador en event_attendees (status='going').
//      Esa fila funciona además como guard de doble ejecución.
//   2. Enviar invitación con botones SOLO a los convocados pre-creados
//      (los "mencionados" que detectó parse-event o se eligieron en el panel).
//   3. Para eventos institucionales (secretariat/mobilization): aviso informativo
//      a press_admin. El resto del Secretariado lo ve en el panel/calendario.
//   4. Programar recordatorios + followup en event_notifications para creador y convocados.
//
// Errores de WhatsApp (externos) se capturan y loguean: no son fatales.
// Errores de DB burbujean: el llamador debe manejarlos si necesita.
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
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

  // Guard de doble ejecución: la fila del creador en event_attendees se crea acá.
  // Si ya existe, este hook ya corrió (ej: doble tap del botón, reproceso).
  const creatorRow = await db.query.eventAttendees.findFirst({
    where: and(
      eq(schema.eventAttendees.event_id, ev.id),
      eq(schema.eventAttendees.user_id, ev.created_by),
    ),
    columns: { id: true },
  });
  if (creatorRow) {
    logger.info({ eventId: ev.id }, 'onEventConfirmed: ya procesado (fila del creador existe), saltando');
    return;
  }

  await db.insert(schema.eventAttendees).values({
    id: uuidv7(),
    event_id: ev.id,
    user_id: ev.created_by,
    status: 'going',
    responded_at: new Date(),
    response_source: 'whatsapp',
  });

  await inviteMentionedAttendees(ev);

  if (ev.type === 'secretariat' || ev.type === 'mobilization') {
    await notifyPressAdmins(ev);
  }

  await scheduleNotifications(ev);
}

// ─── Invitación a los convocados pre-creados (mencionados) ────────────────────

async function inviteMentionedAttendees(event: EventRow): Promise<void> {
  // Convocados pre-creados por parse-event (o el panel), excluyendo al creador
  const attendees = await db
    .select({
      attendee_id: schema.eventAttendees.id,
      user_id: schema.eventAttendees.user_id,
      phone_e164: schema.users.phone_e164,
    })
    .from(schema.eventAttendees)
    .innerJoin(schema.users, eq(schema.eventAttendees.user_id, schema.users.id))
    .where(
      and(
        eq(schema.eventAttendees.event_id, event.id),
        eq(schema.eventAttendees.status, 'invited'),
        ne(schema.eventAttendees.user_id, event.created_by),
        eq(schema.users.is_active, true),
        isNull(schema.users.deleted_at),
      ),
    );

  if (attendees.length === 0) return;

  const eventDateISO = toARTDateISO(event.starts_at);
  const dateStr = formatARTShort(event.starts_at, event.all_day);
  const locationLine = event.location ? `\n📍 ${event.location}` : '';
  const typeLabel = event.type === 'mobilization' ? 'Evento presencial' : event.type === 'secretariat' ? 'Evento online' : 'Evento';

  let sentCount = 0;
  for (const a of attendees) {
    const onLeave = await isUserOnLeave(a.user_id, eventDateISO);
    if (onLeave) {
      await db.update(schema.eventAttendees)
        .set({ status: 'on_leave', updated_at: new Date() })
        .where(eq(schema.eventAttendees.id, a.attendee_id));
      continue;
    }
    await sendInvitation(event, a.phone_e164, dateStr, locationLine, typeLabel);
    sentCount++;
  }

  logger.info(
    { eventId: event.id, attendees: attendees.length, sent: sentCount },
    'onEventConfirmed: invitaciones enviadas a convocados',
  );
}

// ─── Aviso informativo a Prensa (press_admin) ─────────────────────────────────

async function notifyPressAdmins(event: EventRow): Promise<void> {
  const admins = await db
    .select({ id: schema.users.id, phone_e164: schema.users.phone_e164 })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.is_active, true),
        isNull(schema.users.deleted_at),
        eq(schema.users.role, 'press_admin' as const),
        ne(schema.users.id, event.created_by), // si lo creó Prensa, no auto-avisarse
      ),
    );

  if (admins.length === 0) return;

  const creator = await db.query.users.findFirst({
    where: eq(schema.users.id, event.created_by),
    columns: { full_name: true },
  });

  const dateStr = formatARTShort(event.starts_at, event.all_day);
  const locationLine = event.location ? `\n📍 ${event.location}` : '';
  const typeLabel = event.type === 'mobilization' ? 'presencial' : 'online';

  const body =
    `🗓 *Nuevo evento ${typeLabel} agendado*\n\n` +
    `*${event.title}*\n📅 ${dateStr}${locationLine}\n` +
    `_Creado por ${creator?.full_name ?? 'un secretario'}_`;

  for (const admin of admins) {
    await sendWhatsAppTemplate(
      admin.phone_e164,
      'agenda_invitation',
      { title: event.title, date: dateStr, location: event.location ?? '' },
      body,
    ).catch(err =>
      logger.warn({ err, eventId: event.id, adminId: admin.id }, 'onEventConfirmed: fallo aviso a press_admin (no fatal)'),
    );
  }

  logger.info({ eventId: event.id, admins: admins.length }, 'onEventConfirmed: aviso a Prensa enviado');
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
  ['12h', 'reminder_12h', 12 * 60 * 60 * 1000], // legacy: ya no se ofrece en UI
  ['2h',  'reminder_2h',  2  * 60 * 60 * 1000],
  ['0h',  'reminder_0h',  0],
];

async function scheduleNotifications(event: EventRow, opts?: { skipGuard?: boolean }): Promise<void> {
  const remConf = event.reminder_config as ReminderConfig | null;
  if (!remConf) return;

  // Guardia contra doble ejecución (se saltea en reprogramaciones)
  if (!opts?.skipGuard) {
    const existing = await db
      .select({ id: schema.eventNotifications.id })
      .from(schema.eventNotifications)
      .where(eq(schema.eventNotifications.event_id, event.id))
      .limit(1);

    if (existing.length > 0) {
      logger.info({ eventId: event.id }, 'onEventConfirmed: notificaciones ya programadas, saltando');
      return;
    }
  }

  const now = new Date();

  // Destinatarios: creador ('going') + convocados que no estén de licencia ni hayan rechazado
  const attendees = await db
    .select({ user_id: schema.eventAttendees.user_id })
    .from(schema.eventAttendees)
    .where(
      and(
        eq(schema.eventAttendees.event_id, event.id),
        inArray(schema.eventAttendees.status, ['invited', 'going', 'maybe'] as const),
      ),
    );
  const recipientIds = attendees.map(a => a.user_id);

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

// ─── Reprogramación tras edición ──────────────────────────────────────────────

/**
 * Reprograma las notificaciones pendientes de un evento confirmado.
 * Llamar cuando se edita la fecha o el reminder_config desde el panel:
 * borra las pending (las sent/skipped quedan como log) y regenera con los datos nuevos.
 */
export async function rescheduleNotifications(eventId: string): Promise<void> {
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
  if (!event) return;

  await db.delete(schema.eventNotifications).where(
    and(
      eq(schema.eventNotifications.event_id, eventId),
      eq(schema.eventNotifications.status, 'pending'),
    ),
  );

  await scheduleNotifications(event as EventRow, { skipGuard: true });
  logger.info({ eventId }, 'rescheduleNotifications: notificaciones regeneradas');
}
