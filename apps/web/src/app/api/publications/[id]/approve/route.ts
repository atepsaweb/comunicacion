// Endpoint para aprobar una publicación.
// Julián la llama desde el panel de revisión cuando aprueba el texto de una publicación.
// Cambia el estado de la publicación de 'in_review' a 'approved'.
// Solo el rol press_admin puede aprobar publicaciones.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pub = await db.query.publications.findFirst({
    where: eq(schema.publications.id, params.id),
    columns: { id: true, status: true },
  });

  if (!pub) return NextResponse.json({ error: 'Publication not found' }, { status: 404 });

  await db
    .update(schema.publications)
    .set({ status: 'approved', updated_at: new Date() })
    .where(eq(schema.publications.id, params.id));

  return NextResponse.json({ ok: true, status: 'approved' });
}
