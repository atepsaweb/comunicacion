// POST /api/internal/agenda/notifications/dispatch
// Motor de despacho de notificaciones de eventos. Lo invoca n8n cada hora.
//
// Por cada notificación pending cuyo scheduled_for ya llegó:
//   1. Verifica que el evento no esté cancelado ni done (salvo followup al creador)
//   2. Verifica que el usuario no esté de licencia en la fecha del evento
//   3. Verifica preferencias del usuario (excepto eventos is_important)
//   4. Verifica tope diario de mensajes por usuario (excepto is_important)
//   5. Envía el mensaje por WhatsApp y marca la notificación como sent
//   6. Si alguna condición falla, marca como skipped con el motivo
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, lte, count, gte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { isUserOnLeave } from '@/lib/dates';
import { logger } from '@/lib/logger';
import { uuidv7 } from 'uuidv7';

const ART_TZ = 'America/Argentina/Buenos_Aires';

function toARTDateISO(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: ART_TZ });
}

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

// Texto de recordatorio según el tipo de notificación
function buildReminderText(
  kind: string,
  title: string,
  dateStr: string,
  location: string | null,
): string {
  const locLine = location ? `\n📍 ${location}` : '';
  switch (kind) {
    case 'reminder_7d':  return `📅 En 7 días: *${title}*\n${dateStr}${locLine}`;
    case 'reminder_24h': return `📅 Mañana: *${title}*\n${dateStr}${locLine}`;
    case 'reminder_12h': return `⏰ En 12 horas: *${title}*\n${dateStr}${locLine}`;
    case 'reminder_2h':  return `🔔 En 2 horas: *${title}*\n${dateStr}${locLine}`;
    case 'reminder_0h':  return `🔔 *${title}* comienza ahora.${locLine}`;
    case 'followup':     return `¿Cómo salió *${title}*? Contame brevemente para sumarlo al reporte semanal.`;
    default:             return `Recordatorio: *${title}*\n${dateStr}`;
  }
}

// Nombre del template por tipo de notificación
function templateKey(kind: string): string {
  if (kind === 'followup') return 'agenda_followup';
  return 'agenda_reminder';
}

// Verifica si el tipo de notificación es silenciable por prefs del usuario
function isMutedByPrefs(
  kind: string,
  eventType: string,
  prefs: Record<string, Record<string, boolean>> | null,
): boolean {
  if (!prefs) return false;
  const kindMap: Record<string, string> = {
    reminder_7d: '7d', reminder_24h: '24h', reminder_12h: '12h', reminder_2h: '2h', reminder_0h: '0h',
  };
  const prefKey = kindMap[kind];
  if (!prefKey) return false; // invitation y followup no son silenciables por prefs
  const typePrefs = prefs[eventType] as Record<string, boolean> | undefined;
  if (!typePrefs) return false; // sin prefs para este tipo → no silenciado
  return typePrefs[prefKey] === false;
}

async function getDailyCapSetting(): Promise<number> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, 'agenda_max_daily_per_user'),
    columns: { value: true },
  });
  if (!row) return 4;
  const v = row.value as unknown;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'max' in v && typeof (v as Record<string, unknown>).max === 'number') {
    return (v as { max: number }).max;
  }
  return 4;
}

async function getSentTodayCount(userId: string, todayStart: Date): Promise<number> {
  const rows = await db
    .select({ c: count() })
    .from(schema.eventNotifications)
    .where(
      and(
        eq(schema.eventNotifications.user_id, userId),
        eq(schema.eventNotifications.status, 'sent'),
        gte(schema.eventNotifications.sent_at, todayStart),
      ),
    );
  return rows[0]?.c ?? 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const todayARTISO = toARTDateISO(now);
  // Inicio del día en ART (medianoche ART = 03:00 UTC)
  const todayStart = new Date(`${todayARTISO}T03:00:00.000Z`);

  // Cargar notificaciones pending vencidas (lote de hasta 100)
  const pending = await db
    .select({
      id: schema.eventNotifications.id,
      event_id: schema.eventNotifications.event_id,
      user_id: schema.eventNotifications.user_id,
      kind: schema.eventNotifications.kind,
      scheduled_for: schema.eventNotifications.scheduled_for,
    })
    .from(schema.eventNotifications)
    .where(
      and(
        eq(schema.eventNotifications.status, 'pending'),
        lte(schema.eventNotifications.scheduled_for, now),
      ),
    )
    .limit(100);

  if (pending.length === 0) {
    return NextResponse.json({ dispatched: 0, skipped: 0 });
  }

  const dailyCap = await getDailyCapSetting();
  // Cache por userId del count ya enviado hoy (evita N+1 en el loop)
  const dailySentCache = new Map<string, number>();
  // Cache de eventos para evitar re-queries
  const eventCache = new Map<string, {
    title: string;
    type: string;
    status: string;
    starts_at: Date;
    all_day: boolean;
    location: string | null;
    created_by: string;
    is_important: boolean;
  } | null>();
  // Cache de preferencias de usuario
  const prefsCache = new Map<string, Record<string, Record<string, boolean>> | null>();
  // Cache de teléfonos
  const phoneCache = new Map<string, string | null>();

  let dispatched = 0;
  let skipped = 0;

  for (const notif of pending) {
    try {
      // 1. Cargar evento (con cache)
      if (!eventCache.has(notif.event_id)) {
        const ev = await db.query.events.findFirst({
          where: eq(schema.events.id, notif.event_id),
          columns: {
            title: true, type: true, status: true, starts_at: true,
            all_day: true, location: true, created_by: true, is_important: true,
          },
        });
        eventCache.set(notif.event_id, ev ?? null);
      }
      const event = eventCache.get(notif.event_id) ?? null;

      if (!event) {
        await skipNotification(notif.id, 'event_not_found');
        skipped++;
        continue;
      }

      // 2. Evento cancelado → skip (excepto followup al creador, que sigue siendo útil)
      if (event.status === 'cancelled') {
        await skipNotification(notif.id, 'event_cancelled');
        skipped++;
        continue;
      }

      // 3. Teléfono del usuario (con cache)
      if (!phoneCache.has(notif.user_id)) {
        const u = await db.query.users.findFirst({
          where: eq(schema.users.id, notif.user_id),
          columns: { phone_e164: true, is_active: true },
        });
        phoneCache.set(notif.user_id, u?.is_active ? u.phone_e164 : null);
      }
      const phone = phoneCache.get(notif.user_id) ?? null;

      if (!phone) {
        await skipNotification(notif.id, 'user_inactive');
        skipped++;
        continue;
      }

      // 4. Verificar licencia del usuario en la fecha del evento
      const eventDateISO = toARTDateISO(event.starts_at);
      const onLeave = await isUserOnLeave(notif.user_id, eventDateISO);
      if (onLeave) {
        await skipNotification(notif.id, 'on_leave');
        skipped++;
        continue;
      }

      // 5. Preferencias de usuario (con cache) — solo si no es is_important
      if (!event.is_important) {
        if (!prefsCache.has(notif.user_id)) {
          const pref = await db.query.agendaNotificationPrefs.findFirst({
            where: eq(schema.agendaNotificationPrefs.user_id, notif.user_id),
            columns: { prefs: true },
          });
          prefsCache.set(notif.user_id, (pref?.prefs as Record<string, Record<string, boolean>> | null) ?? null);
        }
        const prefs = prefsCache.get(notif.user_id) ?? null;
        if (isMutedByPrefs(notif.kind, event.type, prefs)) {
          await skipNotification(notif.id, 'user_muted');
          skipped++;
          continue;
        }
      }

      // 6. Tope diario (exento para is_important)
      if (!event.is_important) {
        if (!dailySentCache.has(notif.user_id)) {
          const sentToday = await getSentTodayCount(notif.user_id, todayStart);
          dailySentCache.set(notif.user_id, sentToday);
        }
        const sentSoFar = dailySentCache.get(notif.user_id) ?? 0;
        if (sentSoFar >= dailyCap) {
          await skipNotification(notif.id, 'cap_reached');
          skipped++;
          continue;
        }
      }

      // 7. Enviar mensaje
      const dateStr = formatARTShort(event.starts_at, event.all_day);
      const bodyText = buildReminderText(notif.kind, event.title, dateStr, event.location);

      const result = await sendWhatsAppTemplate(
        phone,
        templateKey(notif.kind),
        { title: event.title, date: dateStr, location: event.location ?? '' },
        bodyText,
      );

      // 8. Registrar en outbound_messages
      const [outboundRow] = await db.insert(schema.outboundMessages).values({
        id: uuidv7(),
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        to_phone_e164: phone,
        user_id: notif.user_id,
        purpose: notif.kind === 'followup' ? 'event_followup' : 'event_reminder',
        body: bodyText,
        meta: { eventId: notif.event_id, notificationId: notif.id, kind: notif.kind },
        sent_at: now,
      }).returning({ id: schema.outboundMessages.id });

      // 9. Marcar notificación como sent
      await db.update(schema.eventNotifications).set({
        status: 'sent',
        sent_at: now,
        outbound_message_id: outboundRow?.id ?? null,
      }).where(eq(schema.eventNotifications.id, notif.id));

      // Actualizar cache del tope diario
      dailySentCache.set(notif.user_id, (dailySentCache.get(notif.user_id) ?? 0) + 1);

      dispatched++;
      logger.info(
        { notificationId: notif.id, eventId: notif.event_id, userId: notif.user_id, kind: notif.kind },
        'dispatch: notificación enviada',
      );
    } catch (err) {
      // Error al enviar: marcar como failed, no detener el lote
      logger.error({ err, notificationId: notif.id }, 'dispatch: error al procesar notificación');
      await db.update(schema.eventNotifications).set({ status: 'failed' })
        .where(eq(schema.eventNotifications.id, notif.id));
      skipped++;
    }
  }

  logger.info({ dispatched, skipped, total: pending.length }, 'dispatch: lote completado');
  return NextResponse.json({ dispatched, skipped });
}

async function skipNotification(id: string, reason: string): Promise<void> {
  await db.update(schema.eventNotifications).set({
    status: 'skipped',
    skip_reason: reason,
  }).where(eq(schema.eventNotifications.id, id));
}
