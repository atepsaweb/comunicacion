// Endpoint de verificación normativa del consolidado.
// Julián lo dispara manualmente desde el panel de revisión.
// El proceso:
//   1. Lee el markdown del consolidado
//   2. Llama a Claude Sonnet con la herramienta web_search habilitada
//   3. Claude busca en la web cada referencia legal (leyes, decretos, resoluciones, CCT)
//   4. Produce un informe de verificación en Markdown con ✅/❌/⚠️ por referencia
//   5. Guarda el informe en consolidations.verification_notes_md
// Requiere que la migración 0005 esté aplicada en la base de datos.
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';
import {
  VERIFY_LEGAL_SYSTEM,
  VERIFY_LEGAL_MODEL,
  buildVerifyLegalPrompt,
} from '@/lib/ai/prompts/verify-legal';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
};

type ContentBlock = { type: string; text?: string };
type AnthropicResponse = {
  content: ContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const consolidation = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.id, params.id),
    columns: { id: true, internal_summary_md: true, cycle_id: true },
  });

  if (!consolidation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const startMs = Date.now();
  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let aiError: string | undefined;

  try {
    // web_search_20250305 es un tool server-side de Anthropic.
    // La API maneja el loop de búsqueda internamente y retorna en un solo llamado.
    // El SDK TS aún no expone el tipo de este tool, por eso el cast.
    const response = (await (anthropic.messages.create as (p: unknown) => Promise<AnthropicResponse>)({
      model: VERIFY_LEGAL_MODEL,
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: VERIFY_LEGAL_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildVerifyLegalPrompt(consolidation.internal_summary_md),
        },
      ],
    }));

    outputText = response.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n\n')
      .trim();

    inputTokens = response.usage?.input_tokens ?? 0;
    outputTokens = response.usage?.output_tokens ?? 0;
    success = true;
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    logger.error({ err, consolidationId: params.id }, 'verify-legal ai call failed');
  }

  const latencyMs = Date.now() - startMs;
  const costs = COST_PER_M[VERIFY_LEGAL_MODEL] ?? { input: 3.0, output: 15.0 };
  const costUsd = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

  // Registrar la invocación en la tabla de auditoría (no bloqueante)
  db.insert(schema.aiInvocations)
    .values({
      purpose: 'verify_legal',
      model: VERIFY_LEGAL_MODEL,
      input_messages: [{ role: 'user', content: '(consolidated md omitted)' }],
      output_text: outputText || null,
      output_parsed: null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: 0,
      cost_usd: String(costUsd),
      latency_ms: latencyMs,
      success,
      error: aiError ?? null,
      triggered_by: 'user_action',
      related_cycle_id: consolidation.cycle_id,
    })
    .catch(dbErr => logger.error({ dbErr, consolidationId: params.id }, 'failed to log verify_legal invocation'));

  if (!success) {
    return NextResponse.json({ error: aiError ?? 'AI call failed' }, { status: 500 });
  }

  await db
    .update(schema.consolidations)
    .set({ verification_notes_md: outputText })
    .where(eq(schema.consolidations.id, params.id));

  logger.info(
    { consolidationId: params.id, inputTokens, outputTokens, costUsd, latencyMs },
    'verify-legal completed',
  );

  return NextResponse.json({ ok: true, costUsd, notes: outputText });
}
