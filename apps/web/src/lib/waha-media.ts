import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { logger } from './logger';

const WAHA_URL = process.env.WAHA_URL ?? 'http://wppconnect:3000';
const WAHA_API_KEY = process.env.WPPCONNECT_SECRET_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

/**
 * Resuelve un JID @lid al número E.164 real consultando la API de WAHA.
 * WhatsApp multi-device puede enviar `from` como LID en vez de @c.us.
 * Retorna null si no puede resolver.
 */
export async function resolveWahaPhone(jid: string): Promise<string | null> {
  try {
    const url = `${WAHA_URL}/api/${WAHA_SESSION}/contacts/${encodeURIComponent(jid)}`;
    const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
    if (!res.ok) return null;
    const data = (await res.json()) as { number?: string };
    return data.number ? `+${data.number}` : null;
  } catch {
    return null;
  }
}

/** Descarga media de WAHA y la guarda en destPath. */
export async function downloadWahaMedia(messageId: string, destPath: string): Promise<void> {
  const url = `${WAHA_URL}/api/${WAHA_SESSION}/messages/${encodeURIComponent(messageId)}/download`;

  const res = await fetch(url, {
    headers: { 'X-Api-Key': WAHA_API_KEY },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ messageId, status: res.status, detail }, 'waha media download failed');
    throw new Error(`WAHA media download failed: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  let buffer: Buffer;

  if (contentType.includes('application/json')) {
    // WAHA WEBJS devuelve { body: "<base64>", mimetype: "..." }
    const json = (await res.json()) as { body?: string };
    if (!json.body) throw new Error('WAHA download: empty body in JSON response');
    buffer = Buffer.from(json.body, 'base64');
  } else {
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  logger.info({ messageId, destPath, bytes: buffer.length }, 'audio saved to disk');
}
