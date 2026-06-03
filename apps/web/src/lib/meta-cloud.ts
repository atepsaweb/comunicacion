// Cliente de la API de WhatsApp Business Cloud (Meta).
// Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api/
//
// La Cloud API exige:
//   - Token de acceso permanente del sistema o del usuario (META_ACCESS_TOKEN).
//   - Phone Number ID del número que envía (META_PHONE_NUMBER_ID).
//   - Para mensajes proactivos (fuera de la ventana de 24h del usuario) hay que
//     usar templates previamente aprobados por Meta.
//
// Diferencias importantes con WAHA:
//   - No soporta envío a grupos.
//   - Los archivos multimedia se entregan como media IDs: hay que pedir la URL
//     firmada con un GET previo y después descargar el binario con auth.
//   - Texto libre solo funciona dentro de la ventana de 24h desde el último
//     mensaje del usuario; fuera de eso, Meta rechaza con error 131047.
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { logger } from './logger';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0';
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID ?? '';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN ?? '';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** E.164 con o sin '+' → "549..." (Meta espera sin '+'). */
function toMetaPhone(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '');
}

type MetaSendResponse = {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
};

type MetaErrorResponse = {
  error: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_data?: { messaging_product?: string; details?: string };
  };
};

async function postMessage(payload: Record<string, unknown>): Promise<string> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error('Meta Cloud API credentials missing (META_PHONE_NUMBER_ID/META_ACCESS_TOKEN)');
  }

  const url = `${GRAPH_BASE}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail: MetaErrorResponse | string = text;
    try { detail = JSON.parse(text) as MetaErrorResponse; } catch { /* keep text */ }
    logger.error({ status: res.status, detail, payload }, 'meta sendMessage failed');
    throw new Error(`Meta sendMessage failed: ${res.status} ${typeof detail === 'string' ? detail : detail.error?.message}`);
  }

  const data = JSON.parse(text) as MetaSendResponse;
  const messageId = data.messages?.[0]?.id;
  if (!messageId) throw new Error('Meta sendMessage: no message id in response');
  return messageId;
}

/** Envía texto libre. Solo válido dentro de la ventana de 24h del usuario. */
export async function sendMetaText(phoneE164: string, body: string): Promise<string> {
  return postMessage({
    to: toMetaPhone(phoneE164),
    type: 'text',
    text: { body, preview_url: false },
  });
}

export type TemplateComponent =
  | { type: 'header'; parameters: TemplateParam[] }
  | { type: 'body'; parameters: TemplateParam[] }
  | { type: 'button'; sub_type: 'url' | 'quick_reply'; index: number; parameters: TemplateParam[] };

export type TemplateParam =
  | { type: 'text'; text: string }
  | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: 'date_time'; date_time: { fallback_value: string } };

/**
 * Envía un template aprobado. Permite mensajes fuera de la ventana de 24h.
 * `languageCode` típico: 'es_AR' o 'es' (depende de cómo fue aprobado el template).
 */
export async function sendMetaTemplate(
  phoneE164: string,
  templateName: string,
  languageCode: string,
  components?: TemplateComponent[],
): Promise<string> {
  return postMessage({
    to: toMetaPhone(phoneE164),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components && components.length > 0 ? { components } : {}),
    },
  });
}

/**
 * Resuelve la URL firmada de un media ID y la descarga a destPath.
 * Meta entrega media en dos pasos: GET /{media-id} → JSON con url; GET url → binary.
 */
export async function downloadMetaMedia(mediaId: string, destPath: string): Promise<void> {
  if (!ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN missing');

  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) {
    const detail = await metaRes.text().catch(() => '');
    logger.error({ mediaId, status: metaRes.status, detail }, 'meta media metadata failed');
    throw new Error(`Meta media metadata failed: ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error('Meta media: no url in metadata');

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!binRes.ok) {
    const detail = await binRes.text().catch(() => '');
    logger.error({ mediaId, status: binRes.status, detail }, 'meta media download failed');
    throw new Error(`Meta media download failed: ${binRes.status}`);
  }

  const buffer = Buffer.from(await binRes.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  logger.info({ mediaId, destPath, bytes: buffer.length }, 'meta media saved to disk');
}
