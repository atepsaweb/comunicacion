// Tablas de mensajes: entrantes (de secretarios hacia el sistema) y salientes (del bot hacia secretarios).
// También incluye las transcripciones de audios y las extracciones de documentos/imágenes.
import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';
import { weeklyCycles } from './cycles';
import { messageKindEnum, messageIntentEnum, outboundPurposeEnum, deliveryStatusEnum } from './enums';

// Mensajes que llegan al sistema desde WhatsApp (enviados por los secretarios)
export const inboundMessages = appSchema.table('inbound_messages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Proveedor de WhatsApp que recibió el mensaje (ej: 'meta')
  provider: text('provider').notNull(),
  // ID del mensaje asignado por el proveedor (para evitar duplicados y hacer seguimiento)
  provider_message_id: text('provider_message_id').notNull(),
  // Número de teléfono del remitente en formato E.164
  from_phone_e164: text('from_phone_e164').notNull(),
  // Usuario del sistema al que corresponde ese teléfono (null si no está registrado)
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
  // Ciclo semanal al que pertenece este mensaje (null si llegó fuera de un ciclo activo)
  cycle_id: uuid('cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  // Tipo de mensaje: texto, audio u otro
  kind: messageKindEnum('kind').notNull(),
  // Contenido textual del mensaje (null si es audio o imagen sin OCR)
  text_content: text('text_content'),
  // Ruta del archivo de audio guardado en el servidor (null si no es audio)
  audio_path: text('audio_path'),
  // Duración del audio en segundos (null si no es audio)
  audio_duration_sec: integer('audio_duration_sec'),
  // Soporte de documentos e imágenes (migración 0002)
  // Tipo MIME del archivo adjunto (ej: 'image/jpeg', 'application/pdf')
  mime_type: text('mime_type'),
  // Ruta del documento o imagen guardado en el servidor
  document_path: text('document_path'),
  // Threading de conversación: mensaje citado por el secretario (migración 0002)
  // ID del mensaje de WhatsApp que el secretario está respondiendo
  quoted_wamid: text('quoted_wamid'),
  // Texto del mensaje citado (para entender el contexto de la respuesta)
  quoted_body: text('quoted_body'),
  // Payload completo tal como llegó del webhook (para debug)
  raw_payload: jsonb('raw_payload').notNull(),
  // Intención detectada por la IA en este mensaje
  intent: messageIntentEnum('intent'),
  received_at: timestamp('received_at', { withTimezone: true }).notNull(),
  // Cuándo terminó de procesarse (null si aún no se procesó)
  processed_at: timestamp('processed_at', { withTimezone: true }),
  // Si se descartó, cuándo y por qué (ej: usuario no registrado)
  discarded_at: timestamp('discarded_at', { withTimezone: true }),
  discard_reason: text('discard_reason'),
});

// Transcripciones de audios: Whisper convierte la nota de voz a texto y lo guarda acá
export const transcriptions = appSchema.table('transcriptions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Referencia al mensaje de audio que se transcribió (relación uno a uno)
  inbound_message_id: uuid('inbound_message_id').notNull().unique().references(() => inboundMessages.id, { onDelete: 'restrict' }),
  // El texto completo de lo que dijo el secretario en el audio
  text: text('text').notNull(),
  // Idioma detectado (casi siempre 'es' para español)
  language: text('language').notNull().default('es'),
  // Nombre del modelo de Whisper usado para transcribir (ej: 'medium')
  model: text('model').notNull(),
  duration_sec: integer('duration_sec').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Mensajes que el bot envía a los secretarios (recordatorios, preguntas de seguimiento, etc.)
export const outboundMessages = appSchema.table('outbound_messages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  provider: text('provider').notNull(),
  // ID asignado por Meta al mensaje enviado (null si hubo error antes de enviarlo)
  provider_message_id: text('provider_message_id'),
  // Número de teléfono del destinatario en formato E.164
  to_phone_e164: text('to_phone_e164').notNull(),
  // Usuario destinatario (puede ser null si el mensaje es a un grupo)
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
  cycle_id: uuid('cycle_id').references(() => weeklyCycles.id, { onDelete: 'restrict' }),
  // Para qué se envió este mensaje (ver enums.ts)
  purpose: outboundPurposeEnum('purpose').notNull(),
  // Texto del mensaje enviado
  body: text('body').notNull(),
  // Datos adicionales variables según el purpose (ej: código OTP hasheado)
  meta: jsonb('meta'),
  sent_at: timestamp('sent_at', { withTimezone: true }).notNull(),
  delivery_status: deliveryStatusEnum('delivery_status').notNull().default('sent'),
  // Mensaje de error si falló el envío
  error: text('error'),
});

// Extracción de texto de imágenes y documentos (migración 0002)
export const documentExtractions = appSchema.table('document_extractions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  inbound_message_id: uuid('inbound_message_id').notNull().unique().references(() => inboundMessages.id, { onDelete: 'restrict' }),
  text: text('text').notNull(),
  // 'claude_vision' | 'pdf_extract' | 'docx_extract'
  extraction_method: text('extraction_method').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;
export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type DocumentExtraction = typeof documentExtractions.$inferSelect;
export type NewDocumentExtraction = typeof documentExtractions.$inferInsert;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
