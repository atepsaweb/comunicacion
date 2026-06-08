import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [existing] = await db
    .select({
      id: schema.events.id,
      status: schema.events.status,
      created_by: schema.events.created_by,
    })
    .from(schema.events)
    .where(eq(schema.events.id, params.id))
    .limit(1);

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });

  const { id: userId, role } = session.user;
  const isOwner = existing.created_by === userId;
  const isAdmin = role === 'press_admin' || role === 'executive';

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Solo el creador o el administrador pueden cancelar' }, { status: 403 });
  }
  if (existing.status === 'cancelled') {
    return NextResponse.json({ error: 'El evento ya está cancelado' }, { status: 400 });
  }
  if (existing.status === 'done') {
    return NextResponse.json({ error: 'No se puede cancelar un evento ya finalizado' }, { status: 400 });
  }

  const body = await req.json() as { reason?: unknown };
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  await db
    .update(schema.events)
    .set({
      status: 'cancelled',
      cancellation_reason: reason,
      cancelled_by: userId,
      cancelled_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(schema.events.id, params.id));

  return NextResponse.json({ ok: true });
}
