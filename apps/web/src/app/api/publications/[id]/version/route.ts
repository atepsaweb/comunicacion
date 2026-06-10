// Endpoint para guardar una nueva versión editada de una publicación.
// Julián puede editar el texto de una publicación en el panel y guardar la versión.
// Cada guardado crea una nueva entrada en publication_versions con número incremental
// y la marca como la versión activa actual (current_version_id).
// El historial de versiones previas queda guardado para poder volver atrás.
import { NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

type Body = { body_md: string };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { body_md } = (await req.json()) as Body;
  if (!body_md?.trim()) return NextResponse.json({ error: 'body_md required' }, { status: 400 });

  const pub = await db.query.publications.findFirst({
    where: eq(schema.publications.id, params.id),
    columns: { id: true, status: true },
  });

  if (!pub) return NextResponse.json({ error: 'Publication not found' }, { status: 404 });

  // Calcular el próximo número de versión
  const lastVersion = await db.query.publicationVersions.findFirst({
    where: eq(schema.publicationVersions.publication_id, params.id),
    columns: { version_number: true },
    orderBy: [desc(schema.publicationVersions.version_number)],
  });

  const nextVersion = (lastVersion?.version_number ?? 0) + 1;

  const [version] = await db
    .insert(schema.publicationVersions)
    .values({
      publication_id: params.id,
      version_number: nextVersion,
      body_md: body_md.trim(),
      source: 'human_edited',
      created_by: session.user.id,
    })
    .returning({ id: schema.publicationVersions.id });

  // Actualizar current_version_id
  await db
    .update(schema.publications)
    .set({ current_version_id: version.id, updated_at: new Date() })
    .where(eq(schema.publications.id, params.id));

  return NextResponse.json({ ok: true, versionId: version.id, versionNumber: nextVersion });
}
