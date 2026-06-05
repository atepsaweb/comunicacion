// Cliente central para llamar a la API de Claude (IA de Anthropic).
// Toda llamada a la IA del sistema pasa por este módulo, que:
//   1. Llama a la API de Claude con los parámetros dados
//   2. Calcula el costo de la llamada en dólares
//   3. Registra todo en la tabla ai_invocations de la base de datos para auditoría
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

// Instancia del cliente de Anthropic, autenticado con la API key del entorno
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Precio en USD por millón de tokens para cada modelo.
// Haiku es más barato y se usa para tareas rápidas (clasificar, extraer).
// Sonnet es más potente y se usa para tareas complejas (redactar publicaciones, consolidar).
const COST_TABLE: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cache_read: 0.1 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_read: 0.3 },
};

export type AIPurpose = typeof schema.aiInvocations.$inferInsert['purpose'];
export type AITriggeredBy = typeof schema.aiInvocations.$inferInsert['triggered_by'];

export type SystemBlock = {
  text: string;
  cache?: boolean;
};

export type CallAIParams = {
  purpose: AIPurpose;
  model: string;
  systemBlocks: SystemBlock[];
  userContent: string;
  maxTokens?: number;
  triggeredBy?: AITriggeredBy;
  relatedReportId?: string;
  relatedCycleId?: string;
  promptId?: string;
};

export type CallAIResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  latencyMs: number;
  invocationId: string;
};

/**
 * Función principal: llama a la API de Claude y registra el resultado en la base de datos.
 * Todos los endpoints de IA del sistema usan esta función.
 */
export async function callAI(params: CallAIParams): Promise<CallAIResult> {
  const {
    purpose,
    model,
    systemBlocks,
    userContent,
    triggeredBy = 'workflow',
    relatedReportId,
    relatedCycleId,
    promptId,
  } = params;

  // Construir el contenido del sistema con soporte para prompt caching de Anthropic.
  // Los bloques marcados con cache:true se cachean en la API para reducir costos en llamadas repetidas.
  const systemContent = systemBlocks.map(b => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));

  const startMs = Date.now();
  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let success = false;
  let aiError: string | undefined;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: params.maxTokens ?? 2048,
      system: systemContent,
      messages: [{ role: 'user', content: userContent }],
    });

    outputText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    // cache_read_input_tokens está en el payload de la API pero puede no estar en el tipo TS
    const usageAny = response.usage as unknown as Record<string, number>;
    cacheReadTokens = usageAny['cache_read_input_tokens'] ?? 0;
    success = true;
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    logger.error({ err, model, purpose }, 'ai invocation failed');
  }

  const latencyMs = Date.now() - startMs;
  const costs = COST_TABLE[model] ?? { input: 1.0, output: 5.0, cache_read: 0.1 };
  const costUsd =
    (inputTokens * costs.input + cacheReadTokens * costs.cache_read + outputTokens * costs.output) /
    1_000_000;

  const inputMessages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  let invocationId = '';
  try {
    const [inv] = await db
      .insert(schema.aiInvocations)
      .values({
        purpose,
        model,
        prompt_id: promptId ?? null,
        input_messages: inputMessages,
        output_text: outputText || null,
        output_parsed: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: String(costUsd),
        latency_ms: latencyMs,
        success,
        error: aiError ?? null,
        triggered_by: triggeredBy,
        related_report_id: relatedReportId ?? null,
        related_cycle_id: relatedCycleId ?? null,
      })
      .returning({ id: schema.aiInvocations.id });
    invocationId = inv.id;
  } catch (dbErr) {
    logger.error({ dbErr, purpose, model }, 'failed to log ai_invocation to db');
  }

  if (!success) {
    throw new Error(`AI invocation failed (${purpose}): ${aiError}`);
  }

  logger.info(
    { purpose, model, inputTokens, outputTokens, cacheReadTokens, costUsd, latencyMs },
    'ai invocation ok',
  );

  return { text: outputText, inputTokens, outputTokens, cacheReadTokens, costUsd, latencyMs, invocationId };
}

/**
 * Parsea JSON del texto de respuesta de la IA.
 * Extrae el bloque JSON si hay texto circundante (Haiku a veces agrega markdown).
 */
export function parseAIJson<T>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const raw = match ? match[1].trim() : text.trim();
  return JSON.parse(raw) as T;
}
