import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { extractTextFromImage, extractTextFromPdf } from '@/lib/ai/vision';
import { logger } from '@/lib/logger';

const TRANSCRIBER_URL = process.env.TRANSCRIBER_URL ?? 'http://transcriber:8000';

// Tipos MIME → método de extracción
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

async function extractDocumentText(path: string, mimeType: string): Promise<string> {
  const res = await fetch(`${TRANSCRIBER_URL}/extract-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, mime_type: mimeType }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`transcriber extract-document failed: ${res.status} ${detail}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

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
    columns: {
      id: true,
      kind: true,
      mime_type: true,
      document_path: true,
      cycle_id: true,
      user_id: true,
    },
  });

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  if (msg.kind !== 'other' || !msg.document_path || !msg.mime_type) {
    return NextResponse.json({ skipped: true, reason: 'not_a_processable_document' });
  }

  // Evitar reprocesar si ya existe extracción
  const existing = await db.query.documentExtractions.findFirst({
    where: eq(schema.documentExtractions.inbound_message_id, messageId),
    columns: { id: true },
  });
  if (existing) {
    return NextResponse.json({ skipped: true, reason: 'already_processed' });
  }

  let extractedText = '';
  let method: string;

  if (IMAGE_MIMES.has(msg.mime_type)) {
    // Imagen → Claude Vision
    const { text } = await extractTextFromImage({
      imagePath: msg.document_path,
      mimeType: msg.mime_type,
      messageId: msg.id,
      cycleId: msg.cycle_id ?? undefined,
    });
    extractedText = text;
    method = 'claude_vision';
  } else if (DOCUMENT_MIMES.has(msg.mime_type)) {
    // PDF / Word → transcriber service (extrae texto embebido)
    extractedText = await extractDocumentText(msg.document_path, msg.mime_type);
    method = msg.mime_type === 'application/pdf' ? 'pdf_extract' : 'docx_extract';

    // PDF escaneado (sin texto embebido) → fallback a Claude Vision
    if (!extractedText.trim() && msg.mime_type === 'application/pdf') {
      logger.info({ messageId: msg.id }, 'pdf empty after pdfplumber — falling back to claude vision');
      const { text } = await extractTextFromPdf({
        pdfPath: msg.document_path,
        messageId: msg.id,
        cycleId: msg.cycle_id ?? undefined,
      });
      extractedText = text;
      method = 'claude_vision_pdf';
    }
  } else {
    return NextResponse.json({ error: 'Unsupported mime type', mimeType: msg.mime_type }, { status: 422 });
  }

  if (!extractedText.trim()) {
    return NextResponse.json({ error: 'Extraction returned empty text' }, { status: 422 });
  }

  await db.insert(schema.documentExtractions).values({
    inbound_message_id: messageId,
    text: extractedText,
    extraction_method: method,
  });

  logger.info(
    { messageId, method, chars: extractedText.length, userId: msg.user_id },
    'document extraction stored',
  );

  return NextResponse.json({ messageId, method, chars: extractedText.length });
}
