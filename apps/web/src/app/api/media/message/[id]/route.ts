// Sirve archivos de media (audio, imágenes, documentos) almacenados en /data/.
// Solo accesible para press_admin. El ID del mensaje se usa para buscar la ruta
// del archivo en DB, evitando cualquier posibilidad de path traversal.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, params.id),
    columns: {
      audio_path: true,
      document_path: true,
      mime_type: true,
      kind: true,
    },
  });

  if (!msg) {
    return new NextResponse('Not found', { status: 404 });
  }

  const filePath = msg.audio_path ?? msg.document_path;
  if (!filePath) {
    return new NextResponse('No media', { status: 404 });
  }

  // Todos los archivos de media se almacenan bajo /data/ — rechazar cualquier
  // otra ruta por si acaso hubiera un valor inesperado en DB.
  if (!filePath.startsWith('/data/')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return new NextResponse('File not found on disk', { status: 404 });
  }

  const contentType =
    msg.kind === 'audio'
      ? (msg.mime_type ?? 'audio/ogg')
      : (msg.mime_type ?? 'application/octet-stream');

  // Word/docx se descarga; el resto (imágenes, PDF, audio) se muestra inline.
  const isDownload =
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword';

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': isDownload ? 'attachment' : 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
