// Dispatcher de envíos de WhatsApp. Selecciona el proveedor en runtime
// (WAHA self-hosted o Meta Cloud API) según el setting `whatsapp_provider`.
//
// Funciones expuestas:
//   - sendWhatsAppText(phone, text): texto libre. Para Meta solo es válido
//     dentro de la ventana de 24h del usuario (respuestas a inbound).
//   - sendWhatsAppTemplate(phone, templateKey, vars, fallbackText): envío
//     proactivo. En Meta usa un template aprobado mapeado por `templateKey`
//     en el setting `whatsapp_meta_templates`; en WAHA manda `fallbackText`.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  sendMetaText,
  sendMetaTemplate,
  type TemplateComponent,
  type TemplateParam,
} from './meta-cloud';
import { logger } from './logger';

export type WhatsAppProvider = 'waha' | 'meta';

export type SendResult = {
  provider: WhatsAppProvider;
  providerMessageId: string | null;
};

const WAHA_URL = process.env.WAHA_URL ?? 'http://wppconnect:3000';
const WAHA_API_KEY = process.env.WPPCONNECT_SECRET_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';
const ENV_PROVIDER = (process.env.WHATSAPP_PROVIDER ?? 'waha') as WhatsAppProvider;

let providerCache: { value: WhatsAppProvider; at: number } | null = null;
const PROVIDER_CACHE_MS = 30_000;

/**
 * Lee el proveedor activo. Prefiere el setting `whatsapp_provider` en DB;
 * si no existe, cae al env var `WHATSAPP_PROVIDER`. Cachea 30s en memoria.
 */
export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  if (providerCache && Date.now() - providerCache.at < PROVIDER_CACHE_MS) {
    return providerCache.value;
  }
  const row = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, 'whatsapp_provider'),
    columns: { value: true },
  });
  let value: WhatsAppProvider = ENV_PROVIDER === 'meta' ? 'meta' : 'waha';
  if (row) {
    const v = row.value as unknown;
    const raw =
      typeof v === 'string'
        ? v
        : typeof v === 'object' && v !== null && 'value' in v
          ? String((v as { value: unknown }).value)
          : null;
    if (raw === 'waha' || raw === 'meta') value = raw;
  }
  providerCache = { value, at: Date.now() };
  return value;
}

/** Permite invalidar el cache cuando el setting cambia desde el panel. */
export function clearWhatsAppProviderCache(): void {
  providerCache = null;
}

function toWahaChatId(phoneE164: string): string {
  return `${phoneE164.replace('+', '')}@c.us`;
}

async function sendWahaText(phoneE164: string, text: string): Promise<void> {
  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
    body: JSON.stringify({ session: WAHA_SESSION, chatId: toWahaChatId(phoneE164), text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail, phoneE164 }, 'waha sendText failed');
    throw new Error(`WAHA sendText failed: ${res.status}`);
  }
}

/** Texto libre. En Meta requiere ventana de 24h activa con el destinatario. */
export async function sendWhatsAppText(phoneE164: string, text: string): Promise<SendResult> {
  const provider = await getWhatsAppProvider();
  if (provider === 'meta') {
    const id = await sendMetaText(phoneE164, text);
    logger.info({ phoneE164, provider, providerMessageId: id }, 'whatsapp message sent');
    return { provider, providerMessageId: id };
  }
  await sendWahaText(phoneE164, text);
  logger.info({ phoneE164, provider }, 'whatsapp message sent');
  return { provider, providerMessageId: null };
}

// ─── Templates (envíos proactivos) ────────────────────────────────────────────

type TemplateConfig = {
  name: string;
  language: string;
  /** Nombres de variables en orden, para mapear al body del template ({{1}}, {{2}}…). */
  body_params?: string[];
};
type TemplateMap = Record<string, TemplateConfig>;

async function getTemplateMap(): Promise<TemplateMap> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, 'whatsapp_meta_templates'),
    columns: { value: true },
  });
  if (!row) return {};
  const v = row.value as unknown;
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as TemplateMap;
  return {};
}

/**
 * Envío proactivo (fuera de la ventana de 24h).
 *   - WAHA → manda `fallbackText` como texto libre (sin restricción de ventana).
 *   - Meta + template configurado → manda el template con variables.
 *   - Meta sin template configurado → fallback a texto libre + warning. Sólo
 *     funciona si el destinatario interactuó hace menos de 24h; si no, Meta
 *     rechaza con error 131047 y la excepción burbujea.
 */
export async function sendWhatsAppTemplate(
  phoneE164: string,
  templateKey: string,
  variables: Record<string, string>,
  fallbackText: string,
): Promise<SendResult> {
  const provider = await getWhatsAppProvider();

  if (provider === 'waha') {
    await sendWahaText(phoneE164, fallbackText);
    return { provider, providerMessageId: null };
  }

  const templates = await getTemplateMap();
  const cfg = templates[templateKey];

  if (!cfg) {
    logger.warn(
      { templateKey, phoneE164 },
      'meta template not configured — falling back to free-form text (requires 24h window)',
    );
    const id = await sendMetaText(phoneE164, fallbackText);
    return { provider, providerMessageId: id };
  }

  const components: TemplateComponent[] = [];
  if (cfg.body_params && cfg.body_params.length > 0) {
    const parameters: TemplateParam[] = cfg.body_params.map(name => ({
      type: 'text',
      text: variables[name] ?? '',
    }));
    components.push({ type: 'body', parameters });
  }

  const id = await sendMetaTemplate(phoneE164, cfg.name, cfg.language, components);
  logger.info(
    { phoneE164, templateKey, templateName: cfg.name, providerMessageId: id },
    'meta template sent',
  );
  return { provider, providerMessageId: id };
}
