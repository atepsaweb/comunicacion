// Endpoint que recibe los mensajes entrantes de WhatsApp desde WAHA via webhook.
// Este es el punto de entrada principal del sistema: cada vez que un secretario
// envía un mensaje al número de WhatsApp de ATEPSA, WAHA llama a este endpoint.
// El endpoint guarda el mensaje en la base de datos, descarga el archivo si corresponde
// (audio, imagen, documento), y devuelve flags para que n8n sepa cómo procesarlo.
// Solo puede ser llamado por n8n (requiere el INTERNAL_API_SECRET).
import { NextRequest, NextResponse } from 'next/server';
import { eq, or, desc } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { downloadWahaMedia, resolveWahaPhone } from '@/lib/waha-media';
import { downloadMetaMedia } from '@/lib/meta-cloud';
import { logger } from '@/lib/logger';

// Tipos MIME procesables como documentos (extracción de texto)
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (legacy)
  'text/plain',         // .txt — transcripciones Zoom, notas, etc.
]);

// Tipos MIME procesables como imágenes vía Claude Vision
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// Payload que WAHA envía al webhook (subset relevante).
// El webhook de Meta normaliza al mismo formato, agregando `provider: 'meta'`
// y `payload.media.mediaId` (en lugar de `media.url`).
type WahaWebhookPayload = {
  event?: string;
  session?: string;
  provider?: 'waha' | 'meta';
  payload?: {
    id: string;
    timestamp: number;
    from: string;
    fromMe: boolean;
    to?: string;
    body?: string | null;
    hasMedia?: boolean;
    mediaUrl?: string | null;
    type?: string | null;
    // WEBJS puede omitir `type` en el nivel superior; el tipo real está en _data
    _data?: { type?: string | null };
    // WAHA: { url, mimetype }; Meta: { mediaId, mimetype }
    media?: {
      url?: string;
      mediaId?: string;
      mimetype?: string;
      filename?: string | null;
    } | null;
    // Threading: mensaje que el secretario está citando
    quotedMsg?: { id?: string; body?: string } | null;
  };
};

/** Convierte "5491112345678@c.us" o "5491112345678" → "+5491112345678" */
function normalizeE164(waPhone: string): string {
  return `+${waPhone.split('@')[0]}`;
}

function resolveKind(
  waType?: string,
  hasMedia?: boolean,
): 'text' | 'audio' | 'other' {
  if (waType === 'ptt' || waType === 'audio') return 'audio';
  if (!hasMedia && (waType === 'chat' || !waType)) return 'text';
  return 'other';
}

/** Extensión de archivo según MIME type */
function extFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'docx';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'text/plain') return 'txt';
  return 'bin';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as WahaWebhookPayload;
  const { event, payload } = body;
  const provider = body.provider === 'meta' ? 'meta' : 'waha';

  if (!payload || payload.fromMe) {
    return NextResponse.json({ discarded: true, reason: 'not_inbound_message' });
  }
  // Solo procesar event "message" (inbound); "message.any" duplica por incluir enviados y recibidos
  if (event !== 'message') {
    return NextResponse.json({ discarded: true, reason: 'non_message_event' });
  }

  // Descartar mensajes internos de WhatsApp (notificaciones de sistema, cifrado, etc.)
  // Estos llegan con event="message" pero no son mensajes de usuario y rompen el pipeline de IA.
  const INTERNAL_WA_TYPES = new Set([
    'e2e_notification',   // notificación de cifrado E2E (muy común al reconectar)
    'notification_template',
    'call_log',
    'gp2',                // group participant changes
    'revoked',            // mensaje eliminado
    'ciphertext',         // cifrado pendiente de procesar
  ]);
  const rawType = payload.type ?? payload._data?.type ?? undefined;
  if (rawType && INTERNAL_WA_TYPES.has(rawType)) {
    return NextResponse.json({ discarded: true, reason: 'internal_wa_message', waType: rawType });
  }

  // WhatsApp multi-device (solo WAHA) puede enviar from como LID (@lid)
  let fromPhone = normalizeE164(payload.from);
  if (provider === 'waha' && payload.from.endsWith('@lid')) {
    const resolved = await resolveWahaPhone(payload.from);
    if (resolved) fromPhone = resolved;
  }

  const receivedAt = new Date(payload.timestamp * 1000);
  const kind = resolveKind(payload.type ?? payload._data?.type ?? undefined, payload.hasMedia);
  const mimeType = payload.media?.mimetype ?? null;

  // Threading: conservamos el texto citado (máx 500 chars para no inflar la DB)
  const quotedWamid = payload.quotedMsg?.id ?? null;
  const quotedBody = payload.quotedMsg?.body?.slice(0, 500) ?? null;

  // Idempotencia: WAHA puede reintentar el webhook si n8n tarda en responder
  const existingMsg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.provider_message_id, payload.id),
    columns: { id: true },
  });
  if (existingMsg) {
    logger.warn({ waMessageId: payload.id }, 'inbound: mensaje duplicado — ignorado');
    return NextResponse.json({ discarded: true, reason: 'duplicado' });
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.phone_e164, fromPhone),
    columns: { id: true },
  });

  // Ciclo: primero el open, si no hay el closed más reciente
  const cycle = await db.query.weeklyCycles.findFirst({
    where: or(
      eq(schema.weeklyCycles.status, 'open'),
      eq(schema.weeklyCycles.status, 'closed'),
    ),
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    columns: { id: true, status: true },
  });

  if (!user) {
    const [msg] = await db
      .insert(schema.inboundMessages)
      .values({
        provider,
        provider_message_id: payload.id,
        from_phone_e164: fromPhone,
        user_id: null,
        cycle_id: null,
        kind,
        mime_type: mimeType,
        text_content: null,
        audio_path: null,
        raw_payload: body,
        received_at: receivedAt,
        discarded_at: new Date(),
        discard_reason: 'numero_no_registrado',
      })
      .returning({ id: schema.inboundMessages.id });

    logger.warn({ fromPhone, waMessageId: payload.id }, 'inbound: numero no registrado');
    return NextResponse.json({ discarded: true, reason: 'numero_no_registrado', id: msg.id });
  }

  const cycleSegment = cycle?.id ?? 'uncycled';
  let audioPath: string | null = null;
  let documentPath: string | null = null;

  const downloadByProvider = async (destPath: string): Promise<void> => {
    const p = payload;
    if (provider === 'meta') {
      const mediaId = p.media?.mediaId;
      if (!mediaId) throw new Error('meta payload missing media.mediaId');
      await downloadMetaMedia(mediaId, destPath);
    } else {
      await downloadWahaMedia(p.id, destPath, p.media?.url ?? undefined);
    }
  };

  // Descargar audio
  if (kind === 'audio') {
    const destPath = `/data/audio/inbound/${cycleSegment}/${user.id}/${payload.id}.ogg`;
    try {
      await downloadByProvider(destPath);
      audioPath = destPath;
    } catch (err) {
      logger.error({ err, waMessageId: payload.id, provider }, 'audio download failed — persisting without path');
    }
  }

  // Descargar imágenes y documentos procesables
  if (kind === 'other' && mimeType) {
    const isProcessable = IMAGE_MIME_TYPES.has(mimeType) || DOCUMENT_MIME_TYPES.has(mimeType);
    if (isProcessable) {
      const ext = extFromMime(mimeType);
      const destPath = `/data/documents/inbound/${cycleSegment}/${user.id}/${payload.id}.${ext}`;
      try {
        await downloadByProvider(destPath);
        documentPath = destPath;
      } catch (err) {
        logger.error({ err, waMessageId: payload.id, provider }, 'document download failed — persisting without path');
      }
    }
  }

  let msg: {
    id: string;
    kind: 'text' | 'audio' | 'other';
    mime_type: string | null;
    audio_path: string | null;
    document_path: string | null;
    user_id: string | null;
    cycle_id: string | null;
    text_content: string | null;
  };

  try {
    const [inserted] = await db
      .insert(schema.inboundMessages)
      .values({
        provider,
        provider_message_id: payload.id,
        from_phone_e164: fromPhone,
        user_id: user.id,
        cycle_id: cycle?.id ?? null,
        kind,
        mime_type: mimeType,
        text_content: kind === 'text' ? (payload.body ?? null) : null,
        audio_path: audioPath,
        document_path: documentPath,
        quoted_wamid: quotedWamid,
        quoted_body: quotedBody,
        raw_payload: body,
        received_at: receivedAt,
      })
      .returning({
        id: schema.inboundMessages.id,
        kind: schema.inboundMessages.kind,
        mime_type: schema.inboundMessages.mime_type,
        audio_path: schema.inboundMessages.audio_path,
        document_path: schema.inboundMessages.document_path,
        user_id: schema.inboundMessages.user_id,
        cycle_id: schema.inboundMessages.cycle_id,
        text_content: schema.inboundMessages.text_content,
      });
    msg = inserted;
  } catch (err) {
    // Violación de unique constraint (código 23505): llegaron dos webhooks simultáneos
    // para el mismo mensaje (e.g. message + message.any). El segundo se descarta.
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      logger.warn({ waMessageId: payload.id }, 'inbound: unique constraint — descartado segundo webhook');
      return NextResponse.json({ discarded: true, reason: 'duplicado' });
    }
    throw err;
  }

  logger.info(
    { msgId: msg.id, userId: msg.user_id, kind: msg.kind, mimeType, fromPhone },
    'inbound message persisted',
  );

  // Flags para que n8n sepa cómo rutear este mensaje
  const isUnsupported =
    kind === 'other' &&
    mimeType !== null &&
    !IMAGE_MIME_TYPES.has(mimeType) &&
    !DOCUMENT_MIME_TYPES.has(mimeType);

  const isProcessableDoc =
    kind === 'other' &&
    mimeType !== null &&
    DOCUMENT_MIME_TYPES.has(mimeType) &&
    documentPath !== null;

  const isProcessableImage =
    kind === 'other' &&
    mimeType !== null &&
    IMAGE_MIME_TYPES.has(mimeType) &&
    documentPath !== null;

  return NextResponse.json({
    id: msg.id,
    kind: msg.kind,
    mimeType: msg.mime_type,
    audioPath: msg.audio_path,
    documentPath: msg.document_path,
    userId: msg.user_id,
    cycleId: msg.cycle_id,
    textContent: msg.text_content,
    // Flags de routing para n8n
    isUnsupported,
    isProcessableDoc,
    isProcessableImage,
  });
}
