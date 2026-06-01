import { NextRequest, NextResponse } from 'next/server';
import { eq, or, desc } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { downloadWahaMedia, resolveWahaPhone } from '@/lib/waha-media';
import { logger } from '@/lib/logger';

// Tipos MIME procesables como documentos (extracción de texto en el transcriber)
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (legacy)
]);

// Tipos MIME procesables como imágenes vía Claude Vision
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// Payload que WAHA envía al webhook (subset relevante)
type WahaWebhookPayload = {
  event?: string;
  session?: string;
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
    // WAHA con WHATSAPP_DOWNLOAD_MEDIA descarga el archivo y lo expone aquí
    media?: { url?: string; mimetype?: string; filename?: string | null } | null;
    // Threading: mensaje que el secretario está citando
    quotedMsg?: { id?: string; body?: string } | null;
  };
};

/** Convierte "5491112345678@c.us" → "+5491112345678" */
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
  return 'bin';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as WahaWebhookPayload;
  const { event, payload } = body;

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

  // WhatsApp multi-device puede enviar from como LID (@lid) en vez de @c.us
  let fromPhone = normalizeE164(payload.from);
  if (payload.from.endsWith('@lid')) {
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
        provider: 'waha',
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

  // Descargar audio
  if (kind === 'audio') {
    const destPath = `/data/audio/inbound/${cycleSegment}/${user.id}/${payload.id}.ogg`;
    try {
      await downloadWahaMedia(payload.id, destPath, payload.media?.url ?? undefined);
      audioPath = destPath;
    } catch (err) {
      logger.error({ err, waMessageId: payload.id }, 'audio download failed — persisting without path');
    }
  }

  // Descargar imágenes y documentos procesables
  if (kind === 'other' && mimeType) {
    const isProcessable = IMAGE_MIME_TYPES.has(mimeType) || DOCUMENT_MIME_TYPES.has(mimeType);
    if (isProcessable) {
      const ext = extFromMime(mimeType);
      const destPath = `/data/documents/inbound/${cycleSegment}/${user.id}/${payload.id}.${ext}`;
      try {
        await downloadWahaMedia(payload.id, destPath, payload.media?.url ?? undefined);
        documentPath = destPath;
      } catch (err) {
        logger.error({ err, waMessageId: payload.id }, 'document download failed — persisting without path');
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
        provider: 'waha',
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
