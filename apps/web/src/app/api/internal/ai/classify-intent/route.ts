import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  CLASSIFY_INTENT_SYSTEM,
  CLASSIFY_INTENT_MODEL,
  buildClassifyIntentPrompt,
  type ClassifyIntentOutput,
} from '@/lib/ai/prompts/classify-intent';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

async function resolveMessageText(
  msg: { id: string; kind: string; text_content: string | null },
): Promise<string | null> {
  if (msg.kind === 'audio') {
    const tx = await db.query.transcriptions.findFirst({
      where: eq(schema.transcriptions.inbound_message_id, msg.id),
      columns: { text: true },
    });
    return tx?.text ?? null;
  }
  return msg.text_content;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  }

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, kind: true, text_content: true, cycle_id: true },
  });

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const text = await resolveMessageText(msg);
  if (!text) {
    return NextResponse.json({ error: 'No text to classify' }, { status: 422 });
  }

  const result = await callAI({
    purpose: 'classify_intent',
    model: CLASSIFY_INTENT_MODEL,
    systemBlocks: [{ text: CLASSIFY_INTENT_SYSTEM, cache: true }],
    userContent: buildClassifyIntentPrompt(text),
    relatedCycleId: msg.cycle_id ?? undefined,
  });

  let parsed: ClassifyIntentOutput;
  try {
    parsed = parseAIJson<ClassifyIntentOutput>(result.text);
  } catch {
    logger.error({ raw: result.text, messageId }, 'classify-intent parse error');
    return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
  }

  await db
    .update(schema.inboundMessages)
    .set({ intent: parsed.intent })
    .where(eq(schema.inboundMessages.id, messageId));

  logger.info({ messageId, intent: parsed.intent, confidence: parsed.confidence }, 'intent classified');

  return NextResponse.json({ messageId, intent: parsed.intent, confidence: parsed.confidence });
}
