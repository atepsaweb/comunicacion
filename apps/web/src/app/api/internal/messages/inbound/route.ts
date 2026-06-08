// Endpoint que recibe los mensajes entrantes de WhatsApp normalizados por
// `/api/webhooks/meta` y reenviados por n8n.
// Es el punto de entrada principal del sistema: cada vez que un secretario
// envía un mensaje al número de WhatsApp de ATEPSA, este endpoint guarda el
// mensaje, descarga el archivo si corresponde (audio, imagen, documento) y
// devuelve flags para que n8n sepa cómo procesarlo.
// Solo puede ser llamado internamente (requiere INTERNAL_API_SECRET).
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or, lte, gte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
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

// Payload normalizado que entrega el webhook de Meta tras reenviarlo n8n.
type InboundEnvelope = {
  event?: string;
  provider?: 'meta';
  payload?: {
    id: string;
    timestamp: number;
    from: string;
    fromMe: boolean;
    to?: string;
    body?: string | null;
    hasMedia?: boolean;
    type?: string | null;
    _data?: { type?: string | null };
    media?: {
      mediaId?: string;
      mimetype?: string;
      filename?: string | null;
    } | null;
    quotedMsg?: { id?: string; body?: string } | null;
    // Botones de respuesta rápida (type === 'interactive')
    interactive?: {
      type: string;  // 'button_reply' cuando el usuario presionó un botón
      button_reply?: {
        id: string;    // Formato convencional: "<accion>:<entityId>"
        title: string; // Texto del botón que se mostró al usuario
      };
    } | null;
  };
};

/** Convierte "5491112345678" (E.164 sin +) → "+5491112345678" */
function normalizeE164(waPhone: string): string {
  return `+${waPhone.split('@')[0]}`;
}

function resolveKind(
  waType?: string,
  hasMedia?: boolean,
): 'text' | 'audio' | 'other' {
  if (waType === 'ptt' || waType === 'audio') return 'audio';
  // Los botones de respuesta rápida llegan como type='interactive', se tratan como texto estructurado
  if (waType === 'interactive') return 'text';
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

  const body = (await req.json()) as InboundEnvelope;
  const { event, payload } = body;
  const provider = 'meta' as const;

  if (!payload || payload.fromMe) {
    return NextResponse.json({ discarded: true, reason: 'not_inbound_message' });
  }
  if (event !== 'message') {
    return NextResponse.json({ discarded: true, reason: 'non_message_event' });
  }

  const fromPhone = normalizeE164(payload.from);

  const receivedAt = new Date(payload.timestamp * 1000);
  const kind = resolveKind(payload.type ?? payload._data?.type ?? undefined, payload.hasMedia);
  const mimeType = payload.media?.mimetype ?? null;

  // Threading: conservamos el texto citado (máx 500 chars para no inflar la DB)
  const quotedWamid = payload.quotedMsg?.id ?? null;
  const quotedBody = payload.quotedMsg?.body?.slice(0, 500) ?? null;

  // Idempotencia: Meta puede reintentar el webhook si n8n tarda en responder
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

  // Ciclo: buscar el ciclo cuyo rango de fechas cubre el timestamp del mensaje.
  // La búsqueda por status más reciente (approch anterior) fallaba cuando el ciclo
  // activo estaba en 'processed' o cuando el siguiente ciclo ya estaba 'open'.
  // Incluimos 'processed' para aceptar mensajes tardíos dentro del período del ciclo.
  const cycle = await db.query.weeklyCycles.findFirst({
    where: and(
      or(
        eq(schema.weeklyCycles.status, 'open'),
        eq(schema.weeklyCycles.status, 'closed'),
        eq(schema.weeklyCycles.status, 'processed'),
      ),
      lte(schema.weeklyCycles.starts_at, receivedAt),
      gte(schema.weeklyCycles.ends_at, receivedAt),
    ),
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

  // Detección de botones de respuesta rápida.
  // El intent se puede determinar directamente sin pasar por la IA.
  const isButtonReply =
    payload.type === 'interactive' &&
    payload.interactive?.type === 'button_reply' &&
    typeof payload.interactive?.button_reply?.id === 'string';

  const buttonPayloadId = isButtonReply
    ? (payload.interactive?.button_reply?.id ?? null)
    : null;

  // text_content para button replies = el payload ID (la "acción estructurada" del mensaje).
  // Para texto normal = el cuerpo del mensaje.
  const resolvedTextContent =
    kind === 'text'
      ? (isButtonReply ? buttonPayloadId : (payload.body ?? null))
      : null;

  const cycleSegment = cycle?.id ?? 'uncycled';
  let audioPath: string | null = null;
  let documentPath: string | null = null;

  const downloadByProvider = async (destPath: string): Promise<void> => {
    const mediaId = payload.media?.mediaId;
    if (!mediaId) throw new Error('meta payload missing media.mediaId');
    await downloadMetaMedia(mediaId, destPath);
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
        text_content: resolvedTextContent,
        // Para button replies el intent es determinístico: no hace falta la IA.
        // Para el resto, la IA lo clasificará en un paso posterior.
        intent: isButtonReply ? 'event_confirmation_reply' : undefined,
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
    { msgId: msg.id, userId: msg.user_id, kind: msg.kind, mimeType, fromPhone, isButtonReply, buttonPayloadId },
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
    // Flags para botones de respuesta rápida
    isButtonReply,
    buttonPayloadId,
  });
}
