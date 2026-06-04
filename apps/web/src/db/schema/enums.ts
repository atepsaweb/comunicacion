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
// - unknown: no se pudo determinar la intención
export const messageIntentEnum = pgEnum('message_intent', [
  'report',
  'report_followup_reply',
  'absence_request',
  'weekly_pause',
  'greeting',
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
export const aiPurposeEnum = pgEnum('ai_purpose', [
  'extract',
  'assess_completeness',
  'followup_question',
  'consolidate',
  'draft_social',
  'draft_newsletter',
  'classify_intent',
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
// - otp: código de un solo uso para iniciar sesión en el panel
// - admin_message: mensaje manual enviado por el administrador
export const outboundPurposeEnum = pgEnum('outbound_purpose', [
  'weekly_trigger',
  'reminder',
  'followup_question',
  'consolidation_delivery',
  'otp',
  'admin_message',
  'other',
]);

// Estado de entrega de un mensaje de WhatsApp saliente:
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'sent',
  'delivered',
  'read',
  'failed',
]);
