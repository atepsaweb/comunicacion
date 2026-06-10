// Definición de todos los enumerados (enum) que usa la base de datos.
// Los enums son listas de valores fijos y permitidos para ciertos campos,
// como los roles de usuario, el estado de un ciclo o el tipo de mensaje.
import { pgEnum } from 'drizzle-orm/pg-core';

// Roles de usuario en el sistema:
// - secretary: secretario o vocal del Secretariado Nacional (reporta por WhatsApp)
// - executive: Mesa Ejecutiva (solo lectura de datos de participación)
// - press_admin: Secretario de Prensa (acceso total, revisa y publica)
export const userRoleEnum = pgEnum('user_role', [
  'secretary',
  'executive',
  'press_admin',
]);

// Estados posibles de un ciclo semanal de reporte:
// - pending: creado pero aún no abierto (período futuro)
// - open: activo, los secretarios pueden enviar mensajes
// - closed: venció el plazo, no acepta más mensajes
// - processed: la IA ya procesó y consolidó los reportes
// - published: el consolidado fue aprobado y publicado por Prensa
export const cycleStatusEnum = pgEnum('cycle_status', [
  'pending',
  'open',
  'closed',
  'processed',
  'published',
]);

// Tipos de ausencia registrable:
// - scheduled_leave: licencia programada (vacaciones, enfermedad, etc.)
// - weekly_pause: el secretario avisa que esta semana no reporta (pausa)
export const absenceTypeEnum = pgEnum('absence_type', [
  'scheduled_leave',
  'weekly_pause',
]);

// Origen desde donde se registró la ausencia:
// - whatsapp: el propio secretario avisó por mensaje
// - panel: el secretario la cargó desde el panel web
// - admin: la cargó el administrador (Julián)
export const absenceSourceEnum = pgEnum('absence_source', [
  'whatsapp',
  'panel',
  'admin',
]);

// Tipo de mensaje entrante recibido por WhatsApp:
// - text: mensaje de texto plano
// - audio: nota de voz (se transcribe con Whisper)
// - other: imagen, documento, sticker u otro tipo no procesable
export const messageKindEnum = pgEnum('message_kind', [
  'text',
  'audio',
  'other',
]);

// Intención detectada por la IA en cada mensaje entrante:
// - report: el secretario está enviando su reporte de actividades
// - report_followup_reply: responde una pregunta de seguimiento de la IA
// - absence_request: avisa que no va a reportar esta semana
// - weekly_pause: solicita pausa semanal
// - greeting: saludo sin contenido de reporte ("Hola", "Buenas", "Cómo estás", etc.)
// - event_create: el secretario quiere agendar un evento (módulo Agenda)
// - event_confirmation_reply: responde a la confirmación de un evento pendiente (SÍ/NO/EDITAR en texto)
// - event_outcome_reply: responde al "¿cómo salió?" de un evento ya ocurrido (módulo Agenda)
// - unknown: no se pudo determinar la intención
export const messageIntentEnum = pgEnum('message_intent', [
  'report',
  'report_followup_reply',
  'absence_request',
  'weekly_pause',
  'greeting',
  'event_create',
  'event_confirmation_reply',
  'event_outcome_reply',
  'unknown',
]);

// Estado del reporte de cada secretario en un ciclo dado:
// - draft: recibió mensajes pero la IA aún no lo procesó completamente
// - awaiting_followup: la IA hizo una pregunta de seguimiento y espera respuesta
// - complete: el reporte está completo y listo para consolidar
// - paused: el secretario tomó pausa semanal
// - on_leave: el secretario está de licencia
// - no_report: cerró el ciclo sin enviar nada
export const reportStatusEnum = pgEnum('report_status', [
  'draft',
  'awaiting_followup',
  'complete',
  'paused',
  'on_leave',
  'no_report',
]);

// Prioridad de cada ítem dentro de un reporte:
export const reportItemPriorityEnum = pgEnum('report_item_priority', [
  'low',
  'medium',
  'high',
]);

// Tipo de publicación generada a partir del consolidado semanal:
// - internal_summary: resumen interno para el Secretariado
// - social_instagram / social_facebook / social_x: texto listo para cada red social
// - newsletter: boletín por mail
// - web_article: artículo para el sitio web del gremio
export const publicationKindEnum = pgEnum('publication_kind', [
  'internal_summary',
  'social_instagram',
  'social_facebook',
  'social_x',
  'newsletter',
  'web_article',
]);

// Estado del proceso de revisión de una publicación:
// - draft: recién generada por la IA, sin revisar
// - in_review: Julián la está revisando
// - approved: aprobada, lista para publicar
// - published: ya se publicó en el canal correspondiente
// - discarded: descartada, no se va a usar
export const publicationStatusEnum = pgEnum('publication_status', [
  'draft',
  'in_review',
  'approved',
  'published',
  'discarded',
]);

// Indica quién generó una versión de publicación:
// - ai_generated: la creó automáticamente la IA
// - human_edited: fue editada manualmente por Julián
export const publicationVersionSourceEnum = pgEnum('publication_version_source', [
  'ai_generated',
  'human_edited',
]);

// Estado del consolidado semanal (el resumen unificado de todos los reportes):
// - draft: generado pero no revisado
// - approved: aprobado por Julián
// - sent: ya enviado al Secretariado por WhatsApp
export const consolidationStatusEnum = pgEnum('consolidation_status', [
  'draft',
  'approved',
  'sent',
]);

// Para qué tarea se usó la IA en cada invocación registrada:
// - extract: extraer items del reporte de un secretario
// - assess_completeness: evaluar si el reporte tiene suficiente info
// - followup_question: generar pregunta de seguimiento al secretario
// - consolidate: unificar todos los reportes en uno
// - draft_social / draft_newsletter: redactar publicaciones
// - classify_intent: determinar qué quiso decir el secretario
// - parse_event: interpretar un evento descrito en lenguaje natural (módulo Agenda)
export const aiPurposeEnum = pgEnum('ai_purpose', [
  'extract',
  'assess_completeness',
  'followup_question',
  'consolidate',
  'verify_legal',
  'draft_social',
  'draft_newsletter',
  'classify_intent',
  'parse_event',
  'other',
]);

// Quién o qué disparó la llamada a la IA:
// - workflow: n8n (el orquestador automático)
// - user_action: una acción manual desde el panel web
// - manual_test: prueba manual durante desarrollo
export const aiTriggeredByEnum = pgEnum('ai_triggered_by', [
  'workflow',
  'user_action',
  'manual_test',
]);

// Para qué se enviaron mensajes de WhatsApp salientes:
// - weekly_trigger: el bot abre el ciclo y pide el reporte semanal
// - reminder: recordatorio para secretarios que no reportaron
// - followup_question: pregunta de seguimiento generada por la IA
// - consolidation_delivery: envío del consolidado aprobado
// - admin_message: mensaje manual enviado por el administrador
// - event_invitation: convocatoria a un evento (módulo Agenda)
// - event_reminder: recordatorio escalonado de un evento (módulo Agenda)
// - event_followup: pregunta "¿cómo salió?" al creador, el día después (módulo Agenda)
// - event_proposal: aviso a Mesa Ejecutiva de una propuesta de evento a aprobar (módulo Agenda)
export const outboundPurposeEnum = pgEnum('outbound_purpose', [
  'weekly_trigger',
  'reminder',
  'followup_question',
  'consolidation_delivery',
  'admin_message',
  'event_invitation',
  'event_reminder',
  'event_followup',
  'event_proposal',
  'event_clarification', // bot pide fecha/hora para completar alta de evento por WhatsApp
  'other',
]);

// Estado de entrega de un mensaje de WhatsApp saliente:
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'sent',
  'delivered',
  'read',
  'failed',
]);

// ─── Módulo Agenda ────────────────────────────────────────────────────────────

// Tipo de evento de la agenda:
// - personal: privado, solo lo ve el dueño, sin convocatoria
// - secretariat: evento institucional ONLINE (Zoom/Meet) — en UI se muestra "Online"
// - mobilization: evento institucional PRESENCIAL (reunión en persona, movilización, marcha) — en UI "Presencial"
// Ambos institucionales convocan a todo el Secretariado y requieren aprobación si los crea un secretary.
export const eventTypeEnum = pgEnum('event_type', [
  'personal',
  'secretariat',
  'mobilization',
]);

// Estado de un evento:
// - pending_confirmation: la IA lo parseó y espera SÍ/NO/EDITAR del creador
// - proposed: evento institucional propuesto por un secretario común, espera aprobación de Mesa Ejecutiva
// - confirmed: activo
// - cancelled: cancelado
// - done: ya ocurrió (lo marca el cron post-evento)
export const eventStatusEnum = pgEnum('event_status', [
  'pending_confirmation',
  'proposed',
  'confirmed',
  'cancelled',
  'done',
]);

// Estado de un convocado respecto de un evento:
// - invited: se le envió la convocatoria, sin responder aún
// - going: confirmó asistencia (✅ Voy)
// - not_going: no asiste (❌ No puedo)
// - maybe: tal vez (🤔)
// - no_response: cerró la ventana sin responder
// - on_leave: estaba de licencia en la fecha (no se le convocó)
export const attendeeStatusEnum = pgEnum('attendee_status', [
  'invited',
  'going',
  'not_going',
  'maybe',
  'no_response',
  'on_leave',
]);

// Tipo de notificación de evento que se programa/envía:
// - invitation: convocatoria inicial
// - reminder_7d / reminder_24h / reminder_12h / reminder_2h / reminder_0h: recordatorios escalonados
//   (reminder_12h es legacy: ya no se ofrece en UI pero eventos viejos pueden tenerlo)
// - followup: "¿cómo salió?" al creador, el día después
// - cancellation: aviso de cancelación o reprogramación (exento del tope de mensajes)
export const eventNotificationKindEnum = pgEnum('event_notification_kind', [
  'invitation',
  'reminder_7d',
  'reminder_24h',
  'reminder_12h',
  'reminder_2h',
  'reminder_0h',
  'followup',
  'cancellation',
]);

// Estado de una notificación de evento en la cola:
// - pending: programada, aún no enviada
// - sent: enviada
// - skipped: no se envió (licencia, tope alcanzado, ya confirmó, silenciada, evento cancelado)
// - failed: falló el envío
export const eventNotificationStatusEnum = pgEnum('event_notification_status', [
  'pending',
  'sent',
  'skipped',
  'failed',
]);

// Alcance de un feed iCal de suscripción:
// - all: todos los eventos visibles para el usuario
// - secretariat: solo eventos del Secretariado y movilizaciones
// - personal: solo los eventos personales del usuario
export const icalScopeEnum = pgEnum('ical_scope', [
  'all',
  'secretariat',
  'personal',
]);
