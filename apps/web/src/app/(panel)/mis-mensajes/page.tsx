// "Mis mensajes": cada secretario ve los mensajes que envió al bot, con la
// misma estética que /admin/mensajes pero sin columna de autor. Auto-refresh,
// expand inline y botón de eliminar por fila.
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { and, eq, desc, isNull } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { MisMensajesClient, type MensajeRow } from './mis-mensajes-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MisMensajesPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const rows = await db
    .select({
      id: schema.inboundMessages.id,
      kind: schema.inboundMessages.kind,
      mime_type: schema.inboundMessages.mime_type,
      text_content: schema.inboundMessages.text_content,
      received_at: schema.inboundMessages.received_at,
      processed_at: schema.inboundMessages.processed_at,
      transcription_text: schema.transcriptions.text,
      transcription_duration: schema.transcriptions.duration_sec,
      document_text: schema.documentExtractions.text,
      document_method: schema.documentExtractions.extraction_method,
    })
    .from(schema.inboundMessages)
    .leftJoin(
      schema.transcriptions,
      eq(schema.transcriptions.inbound_message_id, schema.inboundMessages.id),
    )
    .leftJoin(
      schema.documentExtractions,
      eq(schema.documentExtractions.inbound_message_id, schema.inboundMessages.id),
    )
    .where(
      and(
        eq(schema.inboundMessages.user_id, session.user.id),
        isNull(schema.inboundMessages.discarded_at),
      ),
    )
    .orderBy(desc(schema.inboundMessages.received_at))
    .limit(50);

  const messages: MensajeRow[] = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    mimeType: r.mime_type,
    textContent: r.text_content,
    receivedAt: r.received_at.toISOString(),
    processedAt: r.processed_at?.toISOString() ?? null,
    transcriptionText: r.transcription_text,
    transcriptionDuration: r.transcription_duration,
    documentText: r.document_text,
    documentMethod: r.document_method,
  }));

  return <MisMensajesClient initialMessages={messages} />;
}
