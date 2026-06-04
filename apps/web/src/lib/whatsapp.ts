// Cliente único de WhatsApp: Meta Cloud API.
// Reemplazó al proveedor WAHA (whatsapp-web.js) que dejó de usarse al
// migrar al canal oficial. Las funciones expuestas:
//   - sendWhatsAppText(phone, text): texto libre. Sólo válido dentro de la
//     ventana de 24h del usuario (ack, follow-up replies, confirmaciones).
//   - sendWhatsAppTemplate(phone, templateKey, vars, fallbackText): envío
//     proactivo con un template aprobado, mapeado por `templateKey` en el
//     setting `whatsapp_meta_templates`. Si el template no está configurado
//     en el setting, cae a texto libre con `fallbackText` (válido sólo si
//     todavía está abierta la ventana de 24h).
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

export type SendResult = {
  provider: 'meta';
  providerMessageId: string;
};

/** Texto libre. En Meta requiere ventana de 24h activa con el destinatario. */
export async function sendWhatsAppText(phoneE164: string, text: string): Promise<SendResult> {
  const id = await sendMetaText(phoneE164, text);
  logger.info({ phoneE164, providerMessageId: id }, 'whatsapp message sent');
  return { provider: 'meta', providerMessageId: id };
}

// ─── Templates (envíos proactivos) ────────────────────────────────────────────

type TemplateConfig = {
  name: string;
  language: string;
  /** Nombres de variables en orden, para mapear al body del template ({{1}}, {{2}}…). */
  body_params?: string[];
  /**
   * Si true, el template es de tipo Authentication (OTP). Meta requiere un
   * `button` adicional sub_type='url' con el código como parámetro para que
   * funcione el "Copy code" en el chat. El valor del button param es el mismo
   * que el primer body_param.
   */
  auth_otp?: boolean;
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
 *   - Si hay template configurado para `templateKey`, lo manda con variables.
 *   - Si no hay template configurado, cae a texto libre. Esto sólo funciona
 *     si el destinatario interactuó hace menos de 24h; si no, Meta rechaza
 *     con error 131047 y la excepción burbujea.
 */
export async function sendWhatsAppTemplate(
  phoneE164: string,
  templateKey: string,
  variables: Record<string, string>,
  fallbackText: string,
): Promise<SendResult> {
  const templates = await getTemplateMap();
  const cfg = templates[templateKey];

  if (!cfg) {
    logger.warn(
      { templateKey, phoneE164 },
      'meta template not configured — falling back to free-form text (requires 24h window)',
    );
    const id = await sendMetaText(phoneE164, fallbackText);
    return { provider: 'meta', providerMessageId: id };
  }

  const components: TemplateComponent[] = [];
  if (cfg.body_params && cfg.body_params.length > 0) {
    const parameters: TemplateParam[] = cfg.body_params.map(name => ({
      type: 'text',
      text: variables[name] ?? '',
    }));
    components.push({ type: 'body', parameters });

    if (cfg.auth_otp) {
      // Authentication template: el código va también al button "Copy code".
      // Por convención el primer body_param es el código.
      const codeKey = cfg.body_params[0];
      const code = (codeKey ? variables[codeKey] : undefined) ?? '';
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: code }],
      });
    }
  }

  const id = await sendMetaTemplate(phoneE164, cfg.name, cfg.language, components);
  logger.info(
    { phoneE164, templateKey, templateName: cfg.name, providerMessageId: id },
    'meta template sent',
  );
  return { provider: 'meta', providerMessageId: id };
}
