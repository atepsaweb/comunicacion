import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI } from '@/lib/ai/client';
import {
  FOLLOWUP_QUESTION_SYSTEM,
  FOLLOWUP_QUESTION_MODEL,
  buildFollowupQuestionPrompt,
} from '@/lib/ai/prompts/followup-question';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';
import { uuidv7 } from 'uuidv7';

type Body = { reportId: string; topic: string };

function buildReportSummary(
  items: Array<{ title: string; category: string; description_md: string }>,
): string {
  if (items.length === 0) return 'Sin ítems.';
  return items
    .map((it) => `- [${it.category}] ${it.title}: ${it.description_md || '(sin descripción)'}`)
    .join('\n');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { reportId, topic } = (await req.json()) as Body;
  if (!reportId || !topic) {
    return NextResponse.json({ error: 'reportId and topic required' }, { status: 400 });
  }

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, reportId),
    columns: {
      id: true,
      user_id: true,
      cycle_id: true,
      followup_count: true,
    },
  });

  if (!report || !report.user_id) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const [user, items] = await Promise.all([
    db.query.users.findFirst({
      where: eq(schema.users.id, report.user_id),
      columns: { phone_e164: true, full_name: true },
    }),
    db.query.reportItems.findMany({
      where: eq(schema.reportItems.report_id, reportId),
      columns: { title: true, category: true, description_md: true },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const reportSummary = buildReportSummary(items);

  const result = await callAI({
    purpose: 'followup_question',
    model: FOLLOWUP_QUESTION_MODEL,
    systemBlocks: [{ text: FOLLOWUP_QUESTION_SYSTEM, cache: true }],
    userContent: buildFollowupQuestionPrompt(reportSummary, topic),
    relatedReportId: reportId,
    relatedCycleId: report.cycle_id ?? undefined,
  });

  const question = result.text.trim();

  // Enviar por WhatsApp
  try {
    await sendWhatsAppText(user.phone_e164, question);
  } catch (err) {
    logger.error({ err, reportId, phone: user.phone_e164 }, 'followup question send failed');
    return NextResponse.json({ error: 'WhatsApp send failed' }, { status: 503 });
  }

  // Persistir en outbound_messages
  await db.insert(schema.outboundMessages).values({
    id: uuidv7(),
    provider: 'waha',
    to_phone_e164: user.phone_e164,
    user_id: report.user_id,
    cycle_id: report.cycle_id ?? null,
    purpose: 'followup_question',
    body: question,
    meta: { report_id: reportId, topic },
    sent_at: new Date(),
  });

  // Actualizar el reporte: status + followup_count
  await db
    .update(schema.reports)
    .set({
      status: 'awaiting_followup',
      followup_count: report.followup_count + 1,
      updated_at: new Date(),
    })
    .where(eq(schema.reports.id, reportId));

  logger.info(
    { reportId, userId: report.user_id, followup_count: report.followup_count + 1 },
    'followup question sent',
  );

  return NextResponse.json({ question, sent: true });
}
