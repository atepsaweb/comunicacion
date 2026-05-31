import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { Card, CardContent } from '@/components/ui/card';

function kindLabel(kind: string, mimeType: string | null): string {
  if (kind === 'text') return 'Texto';
  if (kind === 'audio') return 'Audio';
  if (kind === 'other') {
    if (!mimeType) return 'Archivo';
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.startsWith('image/')) return 'Imagen';
    if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') return 'Documento Word';
    return 'Archivo';
  }
  return kind;
}

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
    .where(eq(schema.inboundMessages.user_id, session.user.id))
    .orderBy(desc(schema.inboundMessages.received_at))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Mis mensajes</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Mensajes que enviaste al bot de WhatsApp.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-zinc-400 text-sm">
              No enviaste mensajes todavía. Mandá un audio o texto al número de WhatsApp del Secretariado.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((msg) => (
            <li key={msg.id}>
              <Card>
                <CardContent className="py-4 px-5 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-700">
                      {kindLabel(msg.kind, msg.mime_type ?? null)}
                    </span>
                    <span>·</span>
                    <span>
                      {new Date(msg.received_at).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {(msg.processed_at || msg.document_text) && (
                      <>
                        <span>·</span>
                        <span className="text-green-600 font-medium">procesado</span>
                      </>
                    )}
                  </div>

                  {msg.kind === 'text' && msg.text_content && (
                    <p className="text-sm text-zinc-800">{msg.text_content}</p>
                  )}

                  {msg.kind === 'audio' && msg.transcription_text && (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-400">
                        Transcripción ({msg.transcription_duration}s)
                      </p>
                      <p className="text-sm text-zinc-800">{msg.transcription_text}</p>
                    </div>
                  )}

                  {msg.kind === 'audio' && !msg.transcription_text && (
                    <p className="text-sm text-zinc-400 italic">
                      {msg.processed_at
                        ? 'Transcripción no disponible.'
                        : 'Transcripción pendiente...'}
                    </p>
                  )}

                  {msg.kind === 'other' && msg.document_text && (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-400">Texto extraído</p>
                      <p className="text-sm text-zinc-800 whitespace-pre-wrap line-clamp-6">
                        {msg.document_text}
                      </p>
                    </div>
                  )}

                  {msg.kind === 'other' && !msg.document_text && (
                    <p className="text-sm text-zinc-400 italic">
                      Extrayendo contenido...
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
