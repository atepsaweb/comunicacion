// Módulo Agenda: eventos del Secretariado, convocatorias, notificaciones,
// feeds iCal y preferencias de notificación por secretario.
//
// Diseño (ver docs/modulo-agenda/modelo-de-datos.md):
//   - Los eventos NO tienen FK al ciclo semanal: el ciclo se calcula por la fecha
//     (cycleKeyForDate en lib/dates.ts). Permite agendar hoy un evento de julio.
//   - Las propuestas institucionales son events con status='proposed' (no hay tabla aparte).
//   - Las notificaciones se pre-computan en event_notifications al confirmar el evento;
//     un cron horario las despacha re-validando licencia/silencio/cancelación.
import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { reportItems } from './reports';
import { outboundMessages } from './messages';
import {
  eventTypeEnum,
  eventStatusEnum,
  attendeeStatusEnum,
  eventNotificationKindEnum,
  eventNotificationStatusEnum,
  icalScopeEnum,
} from './enums';

// Un evento de la agenda. Lo crea un secretario por WhatsApp o desde el panel.
export const events = appSchema.table('events', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Título corto del evento
  title: text('title').notNull(),
  // Detalle opcional en Markdown
  description_md: text('description_md'),
  // Tipo: personal / secretariat / mobilization (ver enums.ts)
  type: eventTypeEnum('type').notNull(),
  // Estado del ciclo de vida del evento (ver enums.ts)
  status: eventStatusEnum('status').notNull().default('pending_confirmation'),
  // Inicio del evento. Se guarda en UTC; se muestra en ART (America/Argentina/Buenos_Aires).
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  // Fin opcional del evento
  ends_at: timestamp('ends_at', { withTimezone: true }),
  // Evento de día completo (sin hora puntual)
  all_day: boolean('all_day').notNull().default(false),
  // Lugar en texto libre
  location: text('location'),
  // Quién creó el evento
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Quién aprobó el evento (si venía como propuesta institucional)
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  // Si requiere confirmación de asistencia (siempre true en mobilization)
  requires_confirmation: boolean('requires_confirmation').notNull().default(false),
  // Evento NO silenciable: ignora las preferencias del destinatario.
  // Solo lo setean executive/press_admin. Default true para mobilization.
  is_important: boolean('is_important').notNull().default(false),
  // Qué recordatorios dispara el evento: { "7d":bool, "24h":bool, "12h":bool, "2h":bool, "followup":bool }
  reminder_config: jsonb('reminder_config').notNull(),
  // Resultado del evento (respuesta del creador a "¿cómo salió?")
  outcome_md: text('outcome_md'),
  outcome_reported_at: timestamp('outcome_reported_at', { withTimezone: true }),
  // Ítem de reporte que generó el followup (para trazar la integración con el reporte semanal)
  outcome_report_item_id: uuid('outcome_report_item_id').references(() => reportItems.id, { onDelete: 'set null' }),
  // Datos de cancelación
  cancellation_reason: text('cancellation_reason'),
  cancelled_by: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  // Dónde se creó: 'whatsapp' | 'panel'
  source: text('source').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Convocados a un evento y su estado de asistencia. Solo para secretariat/mobilization.
export const eventAttendees = appSchema.table('event_attendees', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Si se borra el evento, se borran sus convocados
  event_id: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: attendeeStatusEnum('status').notNull().default('invited'),
  responded_at: timestamp('responded_at', { withTimezone: true }),
  // Por dónde respondió: 'whatsapp' | 'panel'
  response_source: text('response_source'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cola pre-computada + log de notificaciones de eventos.
// Es el corazón del scheduling: el cron horario lee las pending vencidas y las despacha.
export const eventNotifications = appSchema.table('event_notifications', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  event_id: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  // Destinatario
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Qué notificación es (ver enums.ts)
  kind: eventNotificationKindEnum('kind').notNull(),
  // Cuándo debe salir
  scheduled_for: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  status: eventNotificationStatusEnum('status').notNull().default('pending'),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  // Por qué se salteó: 'on_leave' | 'cap_reached' | 'already_confirmed' | 'event_cancelled' | 'user_muted'
  skip_reason: text('skip_reason'),
  // Link al mensaje saliente real (si se envió)
  outbound_message_id: uuid('outbound_message_id').references(() => outboundMessages.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Tokens de suscripción iCal: tres por usuario (all / secretariat / personal), cada uno revocable.
export const icalTokens = appSchema.table('ical_tokens', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scope: icalScopeEnum('scope').notNull(),
  // String url-safe random (lo que va en la URL del feed). Mismo generador que access_tokens.
  token: text('token').notNull().unique(),
  // Si tiene fecha, el token fue revocado (regenerar = revocar el anterior + crear uno nuevo)
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  // Última vez que un cliente de calendario consultó el feed (auditoría, no afecta validez)
  last_accessed_at: timestamp('last_accessed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Preferencias de notificación por secretario: qué recordatorios quiere recibir, por tipo de evento.
// No afecta eventos is_important (esos se mandan igual). Una fila por usuario.
export const agendaNotificationPrefs = appSchema.table('agenda_notification_prefs', {
  user_id: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  // { "secretariat": {"7d":bool,"24h":bool,"12h":bool,"2h":bool}, "mobilization": {...} }
  // Ausencia de key = hereda el reminder_config del evento (opt-out, no opt-in).
  prefs: jsonb('prefs').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventAttendee = typeof eventAttendees.$inferSelect;
export type NewEventAttendee = typeof eventAttendees.$inferInsert;
export type EventNotification = typeof eventNotifications.$inferSelect;
export type NewEventNotification = typeof eventNotifications.$inferInsert;
export type IcalToken = typeof icalTokens.$inferSelect;
export type NewIcalToken = typeof icalTokens.$inferInsert;
export type AgendaNotificationPref = typeof agendaNotificationPrefs.$inferSelect;
export type NewAgendaNotificationPref = typeof agendaNotificationPrefs.$inferInsert;
