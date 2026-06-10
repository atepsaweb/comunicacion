// Endpoint para notificar al secretario que envió un tipo de archivo no soportado.
// Si un secretario manda, por ejemplo, un sticker, un video o un archivo .zip,
// el sistema le responde explicando que no puede procesarlo y sugiere que lo mande
// por texto o audio. Esto mejora la experiencia del usuario y evita mensajes perdidos.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const UNSUPPORTED_MESSAGE =
  'Recibí tu archivo, pero no puedo procesarlo automáticamente. ' +
  'Si tiene información importante para el reporte de esta semana, mandámela por texto o audio y la incluyo sin problema.';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const messageId = params.id;

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, from_phone_e164: true, mime_type: true, user_id: true },
  });

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!msg.user_id) return NextResponse.json({ skipped: true, reason: 'unregistered_user' });

  try {
    await sendWhatsAppText(msg.from_phone_e164, UNSUPPORTED_MESSAGE);
    logger.info({ messageId, mimeType: msg.mime_type, userId: msg.user_id }, 'unsupported file notification sent');
  } catch (err) {
    logger.error({ err, messageId }, 'failed to notify unsupported file');
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }

  return NextResponse.json({ notified: true });
}
