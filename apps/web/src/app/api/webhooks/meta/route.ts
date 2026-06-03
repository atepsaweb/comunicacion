// Webhook que recibe los eventos de WhatsApp Business Cloud (Meta).
//
// Meta postea acá cuando el número de ATEPSA recibe mensajes, confirmaciones
// de entrega/lectura, o cambios de estado. La URL pública es
// https://panel.atepsa.org.ar/api/webhooks/meta y se registra en el dashboard
// de Meta Developers junto con META_WEBHOOK_VERIFY_TOKEN.
//
// El handler:
//   - GET: responde el `hub.challenge` cuando Meta verifica la suscripción.
//   - POST: valida la firma `X-Hub-Signature-256` (HMAC SHA256 con
//     META_APP_SECRET), normaliza el payload al formato que ya consume el
//     endpoint interno `/api/internal/messages/inbound` (compatible con WAHA),
//     y lo reenvía al webhook de n8n para mantener el routing existente
//     (transcripción, extracción de docs, clasificación de intent, etc.).
//
// Devuelve 200 a Meta lo antes posible: Meta marca el webhook como caído si
// no recibe respuesta en pocos segundos.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

const APP_SECRET = process.env.META_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
const N8N_INBOUND_WEBHOOK_URL =
  process.env.N8N_INBOUND_WEBHOOK_URL ?? 'http://n8n:5678/webhook/whatsapp-inbound';

// ─── Tipos del payload de Meta (subset usado) ──────────────────────────────────

type MetaContext = { from?: string; id?: string };
type MetaTextMessage = { type: 'text'; text: { body: string } };
type MetaMediaPayload = { id: string; mime_type: string; sha256?: string; caption?: string; filename?: string };
type MetaImageMessage = { type: 'image'; image: MetaMediaPayload };
type MetaAudioMessage = { type: 'audio'; audio: MetaMediaPayload & { voice?: boolean } };
type MetaVoiceMessage = { type: 'voice'; voice: MetaMediaPayload };
type MetaDocumentMessage = { type: 'document'; document: MetaMediaPayload };
type MetaVideoMessage = { type: 'video'; video: MetaMediaPayload };
type MetaStickerMessage = { type: 'sticker'; sticker: MetaMediaPayload };
type MetaOtherMessage = { type: string; [key: string]: unknown };

type MetaMessage = (
  | MetaTextMessage
  | MetaImageMessage
  | MetaAudioMessage
  | MetaVoiceMessage
  | MetaDocumentMessage
  | MetaVideoMessage
  | MetaStickerMessage
  | MetaOtherMessage
) & {
  from: string;        // wa_id del remitente, formato E.164 sin '+'
  id: string;          // wamid
  timestamp: string;   // unix segundos como string
  context?: MetaContext; // si es respuesta a otro mensaje
};

type MetaStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
};

type MetaWebhookValue = {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

type MetaWebhookEntry = {
  id: string;
  changes: Array<{ field: 'messages'; value: MetaWebhookValue }>;
};

type MetaWebhookPayload = {
  object: 'whatsapp_business_account';
  entry: MetaWebhookEntry[];
};

// ─── GET: verificación de suscripción ─────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    logger.info('meta webhook verified');
    return new NextResponse(challenge ?? '', { status: 200 });
  }

  logger.warn({ mode, hasToken: Boolean(token) }, 'meta webhook verification failed');
  return new NextResponse('forbidden', { status: 403 });
}

// ─── POST: recepción de eventos ───────────────────────────────────────────────

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!APP_SECRET || !signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const received = signatureHeader.slice(prefix.length);
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return timingSafeEqualHex(received, expected);
}

/**
 * Devuelve el descriptor de media (id, mimetype, filename) y un tipo
 * compatible con el flag `kind` de inbound (`audio` / `other` / `text`).
 */
function extractMedia(msg: MetaMessage): {
  waType: string;
  hasMedia: boolean;
  mediaId?: string;
  mimetype?: string;
  filename?: string | null;
  textBody?: string | null;
} {
  switch (msg.type) {
    case 'text': {
      const m = msg as MetaTextMessage;
      return { waType: 'chat', hasMedia: false, textBody: m.text.body };
    }
    case 'audio':
    case 'voice': {
      const media = ('audio' in msg ? msg.audio : (msg as MetaVoiceMessage).voice) as MetaMediaPayload;
      return {
        waType: 'ptt',
        hasMedia: true,
        mediaId: media.id,
        mimetype: media.mime_type,
        filename: media.filename ?? null,
      };
    }
    case 'image':
    case 'document':
    case 'video':
    case 'sticker': {
      const key = msg.type as 'image' | 'document' | 'video' | 'sticker';
      const media = (msg as unknown as Record<string, MetaMediaPayload>)[key];
      return {
        waType: key,
        hasMedia: true,
        mediaId: media.id,
        mimetype: media.mime_type,
        filename: media.filename ?? null,
      };
    }
    default:
      return { waType: msg.type, hasMedia: false };
  }
}

/**
 * Convierte un MetaMessage al envelope que consume `/api/internal/messages/inbound`.
 * El envelope mantiene compatibilidad con el formato WAHA pero agrega
 * `provider: 'meta'` y `payload.media.mediaId` para que el endpoint sepa
 * cómo descargar la media.
 */
function buildInboundEnvelope(msg: MetaMessage): Record<string, unknown> {
  const m = extractMedia(msg);

  return {
    event: 'message',
    provider: 'meta',
    payload: {
      id: msg.id,
      timestamp: Number(msg.timestamp),
      from: msg.from, // E.164 sin '+' — el normalizador lo prefija
      fromMe: false,
      body: m.textBody ?? null,
      hasMedia: m.hasMedia,
      type: m.waType,
      _data: { type: m.waType },
      media: m.hasMedia
        ? {
            mediaId: m.mediaId,
            mimetype: m.mimetype,
            filename: m.filename ?? null,
          }
        : null,
      quotedMsg: msg.context?.id ? { id: msg.context.id } : null,
    },
  };
}

async function forwardToN8n(envelope: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(N8N_INBOUND_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error({ status: res.status, detail }, 'meta → n8n forward failed');
    }
  } catch (err) {
    logger.error({ err }, 'meta → n8n forward threw');
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const sig = req.headers.get('x-hub-signature-256');

  if (!verifySignature(rawBody, sig)) {
    logger.warn({ hasSig: Boolean(sig) }, 'meta webhook: signature verification failed');
    return new NextResponse('forbidden', { status: 403 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  // Procesamos en background y devolvemos 200 inmediatamente: Meta retira
  // el webhook si tarda demasiado en responder.
  const forwards: Promise<void>[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;

      for (const msg of change.value.messages ?? []) {
        const envelope = buildInboundEnvelope(msg);
        forwards.push(forwardToN8n(envelope));
      }

      for (const status of change.value.statuses ?? []) {
        logger.info(
          { wamid: status.id, status: status.status, recipient: status.recipient_id },
          'meta delivery status',
        );
      }
    }
  }

  // No awaitamos: dejamos que las requests salgan en paralelo.
  Promise.all(forwards).catch(err => logger.error({ err }, 'meta forwards rejected'));

  return NextResponse.json({ received: true });
}
