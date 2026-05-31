import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VISION_MODEL = 'claude-haiku-4-5-20251001';

const VISION_SYSTEM = `Sos un asistente del sistema de reporte semanal de ATEPSA, el sindicato argentino de los trabajadores de navegación aérea.

Recibirás una imagen enviada por un secretario o vocal del Secretariado Nacional por WhatsApp. Puede ser:
- Una foto de un documento (acta, resolución, nota, comunicado, expediente)
- Una captura de pantalla (mail, chat, sistema)
- Una imagen con texto relevante

Tu tarea: extraer y transcribir todo el texto visible en la imagen que sea relevante para el reporte semanal. Si hay texto, transcribilo con fidelidad. Si la imagen es un gráfico o foto sin texto, describí brevemente qué muestra y por qué puede ser relevante para la actividad gremial.

Respondé SOLO con el texto extraído o la descripción, sin prefijos, sin JSON, sin explicación adicional. Máximo 800 palabras.`;

const PDF_SYSTEM = `Sos un asistente del sistema de reporte semanal de ATEPSA, el sindicato argentino de los trabajadores de navegación aérea.

Recibirás un documento PDF escaneado enviado por un secretario o vocal del Secretariado Nacional por WhatsApp. Puede ser: un acta, resolución, nota, comunicado, expediente, volante o cualquier documento gremial o institucional.

Tu tarea: extraé y transcribí todo el texto visible en el documento con la mayor fidelidad posible. Mantené la estructura original (párrafos, títulos, listas, fechas, firmas). Si hay partes ilegibles indicalo brevemente.

Respondé SOLO con el texto extraído, sin prefijos, sin JSON, sin explicación adicional.`;

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const MIME_TO_MEDIA_TYPE: Record<string, MediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

export async function extractTextFromImage(params: {
  imagePath: string;
  mimeType: string;
  messageId: string;
  cycleId?: string;
}): Promise<{ text: string; invocationId: string }> {
  const { imagePath, mimeType, messageId, cycleId } = params;

  const mediaType = MIME_TO_MEDIA_TYPE[mimeType] ?? 'image/jpeg';
  const imageBuffer = await readFile(imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  const startMs = Date.now();
  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let aiError: string | undefined;

  try {
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system: VISION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: 'Extraé el texto o describí el contenido de esta imagen para el reporte semanal.',
            },
          ],
        },
      ],
    });

    outputText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    success = true;
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    logger.error({ err, imagePath, messageId }, 'vision extraction failed');
  }

  const latencyMs = Date.now() - startMs;
  // Haiku: $1/Mtok input, $5/Mtok output (mismos rates que texto)
  const costUsd = (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;

  let invocationId = '';
  try {
    const [inv] = await db
      .insert(schema.aiInvocations)
      .values({
        purpose: 'other',
        model: VISION_MODEL,
        prompt_id: null,
        input_messages: [{ role: 'user', content: '[image + text prompt]' }],
        output_text: outputText || null,
        output_parsed: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: 0,
        cost_usd: String(costUsd),
        latency_ms: latencyMs,
        success,
        error: aiError ?? null,
        triggered_by: 'workflow',
        related_report_id: null,
        related_cycle_id: cycleId ?? null,
      })
      .returning({ id: schema.aiInvocations.id });
    invocationId = inv.id;
  } catch (dbErr) {
    logger.error({ dbErr, messageId }, 'failed to log vision invocation');
  }

  if (!success) throw new Error(`Vision extraction failed: ${aiError}`);

  logger.info({ messageId, inputTokens, outputTokens, costUsd, latencyMs }, 'vision extraction ok');
  return { text: outputText, invocationId };
}

/**
 * Extrae texto de un PDF escaneado enviándolo a Claude como documento base64.
 * Usar cuando pdfplumber devuelva texto vacío (PDF sin capa de texto).
 */
export async function extractTextFromPdf(params: {
  pdfPath: string;
  messageId: string;
  cycleId?: string;
}): Promise<{ text: string; invocationId: string }> {
  const { pdfPath, messageId, cycleId } = params;

  const pdfBuffer = await readFile(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  const startMs = Date.now();
  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let aiError: string | undefined;

  try {
    // El SDK de Anthropic no tipea 'document' content blocks en todas las versiones.
    // Casteamos el array de messages para evitar el error de tipo.
    const pdfMessages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          {
            type: 'text',
            text: 'Extraé todo el texto de este documento escaneado.',
          },
        ],
      },
    ] as Anthropic.Messages.MessageParam[];

    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 2048,
      system: PDF_SYSTEM,
      messages: pdfMessages,
    });

    outputText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    success = true;
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    logger.error({ err, pdfPath, messageId }, 'pdf vision extraction failed');
  }

  const latencyMs = Date.now() - startMs;
  const costUsd = (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;

  let invocationId = '';
  try {
    const [inv] = await db
      .insert(schema.aiInvocations)
      .values({
        purpose: 'other',
        model: VISION_MODEL,
        prompt_id: null,
        input_messages: [{ role: 'user', content: '[pdf document]' }],
        output_text: outputText || null,
        output_parsed: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: 0,
        cost_usd: String(costUsd),
        latency_ms: latencyMs,
        success,
        error: aiError ?? null,
        triggered_by: 'workflow',
        related_report_id: null,
        related_cycle_id: cycleId ?? null,
      })
      .returning({ id: schema.aiInvocations.id });
    invocationId = inv.id;
  } catch (dbErr) {
    logger.error({ dbErr, messageId }, 'failed to log pdf vision invocation');
  }

  if (!success) throw new Error(`PDF vision extraction failed: ${aiError}`);

  logger.info({ messageId, inputTokens, outputTokens, costUsd, latencyMs }, 'pdf vision extraction ok');
  return { text: outputText, invocationId };
}
