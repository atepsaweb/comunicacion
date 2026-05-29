import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { logger } from '@/lib/logger';

type AttachTranscriptionBody = {
  text: string;
  duration_sec: number;
  model: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  const body = (await req.json()) as AttachTranscriptionBody;
  const { text, duration_sec, model } = body;

  if (!text || typeof duration_sec !== 'number' || !model) {
    return NextResponse.json({ error: 'Missing required fields: text, duration_sec, model' }, { status: 400 });
  }

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, id),
    columns: { id: true, kind: true },
  });

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (msg.kind !== 'audio') {
    return NextResponse.json({ error: 'Message is not audio' }, { status: 400 });
  }

  await db.insert(schema.transcriptions).values({
    inbound_message_id: id,
    text,
    language: 'es',
    model,
    duration_sec,
  });

  await db
    .update(schema.inboundMessages)
    .set({ processed_at: new Date() })
    .where(eq(schema.inboundMessages.id, id));

  logger.info({ msgId: id, chars: text.length, duration_sec }, 'transcription attached');

  return NextResponse.json({ ok: true });
}
