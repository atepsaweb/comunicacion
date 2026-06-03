// Endpoint genérico para que n8n (u otros consumidores internos) envíen
// mensajes de WhatsApp pasando por el dispatcher del panel.
// Evita que cada workflow hable directo con WAHA o Meta: así el switch de
// proveedor se hace en un solo lugar (system_settings.whatsapp_provider).
//
// Body:
//   {
//     to: "+5491158791245",
//     text: "texto plano (fallback si hay templateKey, contenido si no)",
//     templateKey?: "escalation_alert",            // si presente → proactivo
//     variables?: { firstName: "...", count: "3" }, // variables del template
//     purpose?: "other" | "weekly_trigger" | ...    // para outbound_messages
//     userId?: "uuid",
//     cycleId?: "uuid",
//   }
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { sendWhatsAppText, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

const PURPOSES = [
  'weekly_trigger',
  'reminder',
  'followup_question',
  'consolidation_delivery',
  'otp',
  'admin_message',
  'other',
] as const;

const bodySchema = z.object({
  to: z.string().min(8).max(20),
  text: z.string().min(1),
  templateKey: z.string().min(1).optional(),
  variables: z.record(z.string()).optional(),
  purpose: z.enum(PURPOSES).default('other'),
  userId: z.string().uuid().optional(),
  cycleId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'Invalid body', detail: String(err) }, { status: 400 });
  }

  const { to, text, templateKey, variables, purpose, userId, cycleId } = parsed;

  try {
    const result = templateKey
      ? await sendWhatsAppTemplate(to, templateKey, variables ?? {}, text)
      : await sendWhatsAppText(to, text);

    await db.insert(schema.outboundMessages).values({
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      to_phone_e164: to,
      user_id: userId ?? null,
      cycle_id: cycleId ?? null,
      purpose,
      body: text,
      meta: templateKey ? { templateKey, variables: variables ?? {} } : null,
      sent_at: new Date(),
      delivery_status: 'sent',
    });

    return NextResponse.json({
      sent: true,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
    });
  } catch (err) {
    logger.error({ err, to, templateKey, purpose }, 'internal/whatsapp/send failed');
    return NextResponse.json(
      { error: 'send failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
