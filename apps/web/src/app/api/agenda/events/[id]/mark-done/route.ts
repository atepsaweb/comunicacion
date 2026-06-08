// POST /api/agenda/events/[id]/mark-done
// Marca un evento confirmado como finalizado (done).
// Lo puede llamar el creador, press_admin, o el cron diario de n8n
// (que lo llama via /api/internal/agenda/events-done-check).
//
// También marca como 'skipped' las notificaciones pending que queden pendientes.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: userId, role } = session.user;
  const eventId = params.id;

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { id: true, status: true, created_by: true },
  });

  if (!event) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });

  const isOwner = event.created_by === userId;
  const isAdmin = role === 'press_admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
  }

  if (event.status === 'done') {
    return NextResponse.json({ ok: true, note: 'ya estaba marcado como finalizado' });
  }

  if (event.status !== 'confirmed') {
    return NextResponse.json(
      { error: 'Solo se pueden marcar como finalizados los eventos confirmados' },
      { status: 400 },
    );
  }

  // Marcar evento como done
  await db.update(schema.events).set({
    status: 'done',
    updated_at: new Date(),
  }).where(eq(schema.events.id, eventId));

  // Cancelar notificaciones pendientes que ya no tienen sentido
  await db.update(schema.eventNotifications).set({
    status: 'skipped',
    skip_reason: 'event_done',
  }).where(
    and(
      eq(schema.eventNotifications.event_id, eventId),
      eq(schema.eventNotifications.status, 'pending'),
    ),
  );

  return NextResponse.json({ ok: true });
}
