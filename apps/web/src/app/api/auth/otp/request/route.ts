import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { otpCodes, users } from '@/db/schema';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';
import { normalizeArgPhone } from '@/lib/utils';
import { uuidv7 } from 'uuidv7';

const OTP_TTL_SECONDS = 5 * 60; // 5 minutos
const RATE_LIMIT_SECONDS = 60;  // esperar 60s entre solicitudes

const bodySchema = z.object({
  phone: z.string().min(8).max(20),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawPhone: string;
  try {
    const body = await req.json() as unknown;
    ({ phone: rawPhone } = bodySchema.parse(body));
  } catch {
    return NextResponse.json({ error: 'Número inválido.' }, { status: 400 });
  }

  const phone = normalizeArgPhone(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: 'Número inválido.' }, { status: 400 });
  }

  // Buscar usuario activo con ese número
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.phone_e164, phone), eq(users.is_active, true)))
    .limit(1);

  if (!user) {
    // Respuesta genérica para no revelar si el número está registrado
    logger.warn({ phone }, 'otp request for unknown phone');
    return NextResponse.json({ ok: true });
  }

  // Rate limit: no generar nuevo código si hay uno creado en los últimos 60s
  const since = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const [recent] = await db
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phone_e164, phone),
        isNull(otpCodes.consumed_at),
        gt(otpCodes.created_at, since),
      ),
    )
    .limit(1);

  if (recent) {
    return NextResponse.json(
      { error: 'Esperá un momento antes de solicitar otro código.' },
      { status: 429 },
    );
  }

  // Generar código de 6 dígitos
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  const code_hash = await bcrypt.hash(code, 10);
  const expires_at = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  // Invalidar cualquier OTP previo no consumido del mismo teléfono:
  // el nuevo código pisa al anterior, evita que la verificación tome uno viejo
  // (p. ej. uno que nunca llegó por caída de WhatsApp) y devuelva "código incorrecto".
  await db
    .update(otpCodes)
    .set({ consumed_at: new Date() })
    .where(and(eq(otpCodes.phone_e164, phone), isNull(otpCodes.consumed_at)));

  await db.insert(otpCodes).values({
    id: uuidv7(),
    user_id: user.id,
    phone_e164: phone,
    code_hash,
    expires_at,
  });

  try {
    await sendWhatsAppText(
      phone,
      `Tu código de acceso a ATEPSA: *${code}*\nVálido por 5 minutos. No lo compartás.`,
    );
  } catch (err) {
    logger.error({ err, phone }, 'failed to send otp via whatsapp');
    return NextResponse.json(
      { error: 'No se pudo enviar el código. Intentá de nuevo.' },
      { status: 503 },
    );
  }

  logger.info({ userId: user.id, phone }, 'otp sent');
  return NextResponse.json({ ok: true });
}
