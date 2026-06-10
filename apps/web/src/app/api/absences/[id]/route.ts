// Endpoint para eliminar (cancelar) una ausencia.
// Un secretario puede cancelar solo sus propias ausencias.
// El press_admin puede cancelar las de cualquier secretario.
// Se usa desde la pantalla de ausencias para "Cancelar" una ausencia futura.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // press_admin puede borrar cualquiera; los demás solo las propias
  const where =
    session.user.role === 'press_admin'
      ? eq(schema.absences.id, params.id)
      : and(eq(schema.absences.id, params.id), eq(schema.absences.user_id, session.user.id));

  const deleted = await db
    .delete(schema.absences)
    .where(where)
    .returning({ id: schema.absences.id });

  if (!deleted.length) {
    return NextResponse.json({ error: 'No encontrada o sin permiso' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
