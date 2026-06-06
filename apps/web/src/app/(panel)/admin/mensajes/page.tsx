// Vista en vivo de todos los mensajes entrantes (solo press_admin).
// Server component que trae los últimos 100 mensajes con autor, transcripción
// y extracción si las tienen, y los pasa a un client component que hace
// auto-refresh cada 10s.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { eq, desc, isNull, notInArray, or } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { MensajesLiveClient, type MensajeRow } from './mensajes-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminMensajesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const rows = await db
    .select({
      id: schema.inboundMessages.id,
      kind: schema.inboundMessages.kind,
      mime_type: schema.inboundMessages.mime_type,
      text_content: schema.inboundMessages.text_content,
      received_at: schema.inboundMessages.received_at,
      processed_at: schema.inboundMessages.processed_at,
      discarded_at: schema.inboundMessages.discarded_at,
      discard_reason: schema.inboundMessages.discard_reason,
      from_phone_e164: schema.inboundMessages.from_phone_e164,
      provider: schema.inboundMessages.provider,
      transcription_text: schema.transcriptions.text,
      transcription_duration: schema.transcriptions.duration_sec,
      document_text: schema.documentExtractions.text,
      document_method: schema.documentExtractions.extraction_method,
      user_full_name: schema.users.full_name,
      user_position: schema.users.position,
      audio_path: schema.inboundMessages.audio_path,
      document_path: schema.inboundMessages.document_path,
    })
    .from(schema.inboundMessages)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.inboundMessages.user_id),
    )
    .leftJoin(
      schema.transcriptions,
      eq(schema.transcriptions.inbound_message_id, schema.inboundMessages.id),
    )
    .leftJoin(
      schema.documentExtractions,
      eq(schema.documentExtractions.inbound_message_id, schema.inboundMessages.id),
    )
    // Excluir los mensajes que el usuario o el admin eliminaron explicitamente
    // desde el panel: son borrados intencionales y no deben aparecer ni con el
    // toggle "Mostrar descartados". Los otros tipos de descarte (numero no
    // registrado, duplicados, mensajes internos) si pueden mostrarse.
    .where(
      or(
        isNull(schema.inboundMessages.discard_reason),
        notInArray(schema.inboundMessages.discard_reason, [
          'deleted_by_user',
          'deleted_by_admin',
        ]),
      ),
    )
    .orderBy(desc(schema.inboundMessages.received_at))
    .limit(100);

  const messages: MensajeRow[] = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    mimeType: r.mime_type,
    textContent: r.text_content,
    receivedAt: r.received_at.toISOString(),
    processedAt: r.processed_at?.toISOString() ?? null,
    discardedAt: r.discarded_at?.toISOString() ?? null,
    discardReason: r.discard_reason,
    fromPhoneE164: r.from_phone_e164,
    provider: r.provider,
    transcriptionText: r.transcription_text,
    transcriptionDuration: r.transcription_duration,
    documentText: r.document_text,
    documentMethod: r.document_method,
    userFullName: r.user_full_name,
    userPosition: r.user_position,
    audioPath: r.audio_path,
    documentPath: r.document_path,
  }));

  return <MensajesLiveClient initialMessages={messages} />;
}
