// Endpoint para descartar una publicación.
// Julián lo usa cuando decide que un borrador no sirve y no quiere publicarlo.
// Cambia el estado a 'discarded'. Solo press_admin puede descartar publicaciones.
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
    .set({ status: 'discarded', updated_at: new Date() })
    .where(eq(schema.publications.id, params.id));

  return NextResponse.json({ ok: true, status: 'discarded' });
}
