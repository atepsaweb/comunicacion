import { NextRequest, NextResponse } from 'next/server';
import { eq, or, desc } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { downloadWahaMedia } from '@/lib/waha-media';
import { logger } from '@/lib/logger';

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
    type?: string;
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as WahaWebhookPayload;
  const { event, payload } = body;

  if (!payload || payload.fromMe) {
    return NextResponse.json({ discarded: true, reason: 'not_inbound_message' });
  }
  if (event && !['message', 'message.any'].includes(event)) {
    return NextResponse.json({ discarded: true, reason: 'non_message_event' });
  }

  const fromPhone = normalizeE164(payload.from);
  const receivedAt = new Date(payload.timestamp * 1000);
  const kind = resolveKind(payload.type, payload.hasMedia);

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

  let audioPath: string | null = null;

  if (kind === 'audio') {
    const cycleSegment = cycle?.id ?? 'uncycled';
    const destPath = `/data/audio/inbound/${cycleSegment}/${user.id}/${payload.id}.ogg`;
    try {
      await downloadWahaMedia(payload.id, destPath);
      audioPath = destPath;
    } catch (err) {
      logger.error({ err, waMessageId: payload.id }, 'audio download failed — persisting without path');
    }
  }

  const [msg] = await db
    .insert(schema.inboundMessages)
    .values({
      provider: 'waha',
      provider_message_id: payload.id,
      from_phone_e164: fromPhone,
      user_id: user.id,
      cycle_id: cycle?.id ?? null,
      kind,
      text_content: kind === 'text' ? (payload.body ?? null) : null,
      audio_path: audioPath,
      raw_payload: body,
      received_at: receivedAt,
    })
    .returning({
      id: schema.inboundMessages.id,
      kind: schema.inboundMessages.kind,
      audio_path: schema.inboundMessages.audio_path,
      user_id: schema.inboundMessages.user_id,
      cycle_id: schema.inboundMessages.cycle_id,
      text_content: schema.inboundMessages.text_content,
    });

  logger.info(
    { msgId: msg.id, userId: msg.user_id, kind: msg.kind, fromPhone },
    'inbound message persisted',
  );

  return NextResponse.json({
    id: msg.id,
    kind: msg.kind,
    audioPath: msg.audio_path,
    userId: msg.user_id,
    cycleId: msg.cycle_id,
    textContent: msg.text_content,
  });
}
