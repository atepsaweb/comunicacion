// Endpoint para aprobar el consolidado semanal.
// Julián lo llama desde el panel de revisión cuando está conforme con el contenido del consolidado.
// Cambia el estado de 'draft' a 'approved' y registra quién lo aprobó y cuándo.
// Solo el rol press_admin puede aprobar consolidados.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const consolidation = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.id, params.id),
    columns: { id: true, status: true },
  });

  if (!consolidation) return NextResponse.json({ error: 'Consolidado no encontrado' }, { status: 404 });

  await db
    .update(schema.consolidations)
    .set({ status: 'approved', reviewed_by: session.user.id, reviewed_at: new Date() })
    .where(eq(schema.consolidations.id, params.id));

  logger.info({ consolidationId: params.id, userId: session.user.id }, 'consolidation approved');

  return NextResponse.json({ ok: true, status: 'approved' });
}
