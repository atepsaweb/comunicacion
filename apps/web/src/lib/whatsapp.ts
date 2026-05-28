import { logger } from './logger';

const WAHA_URL = process.env.WAHA_URL ?? 'http://wppconnect:3000';
const WAHA_API_KEY = process.env.WPPCONNECT_SECRET_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

/** Convierte un número E.164 al chatId de WhatsApp (sin '+', con '@c.us'). */
function toChatId(phoneE164: string): string {
  return `${phoneE164.replace('+', '')}@c.us`;
}

export async function sendWhatsAppText(phoneE164: string, text: string): Promise<void> {
  const url = `${WAHA_URL}/api/sendText`;
  const body = {
    session: WAHA_SESSION,
    chatId: toChatId(phoneE164),
    text,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': WAHA_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail, phoneE164 }, 'waha sendText failed');
    throw new Error(`WAHA sendText failed: ${res.status}`);
  }

  logger.info({ phoneE164 }, 'whatsapp message sent');
}
