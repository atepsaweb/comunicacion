// POST /api/agenda/events/[id]/attendance
// Actualiza el estado de asistencia del usuario autenticado desde el panel web.
// Equivalente a respond_yes/no/maybe pero sin pasar por WhatsApp.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const VALID_STATUSES = ['going', 'not_going', 'maybe'] as const;
type AttendanceStatus = (typeof VALID_STATUSES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: userId } = session.user;
  const eventId = params.id;

  const body = await req.json() as Record<string, unknown>;
  const status = body.status as string;

  if (!VALID_STATUSES.includes(status as AttendanceStatus)) {
    return NextResponse.json(
      { error: `status inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const attendee = await db.query.eventAttendees.findFirst({
    where: and(
      eq(schema.eventAttendees.event_id, eventId),
      eq(schema.eventAttendees.user_id, userId),
    ),
    columns: { id: true, status: true },
  });

  if (!attendee) {
    return NextResponse.json({ error: 'No sos convocado a este evento' }, { status: 403 });
  }

  if (attendee.status === 'on_leave') {
    return NextResponse.json({ error: 'Estás de licencia en la fecha de este evento' }, { status: 400 });
  }

  await db.update(schema.eventAttendees).set({
    status: status as AttendanceStatus,
    responded_at: new Date(),
    response_source: 'panel',
    updated_at: new Date(),
  }).where(eq(schema.eventAttendees.id, attendee.id));

  return NextResponse.json({ ok: true, status });
}
