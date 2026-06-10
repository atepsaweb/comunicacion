// GET /api/agenda/events/[id]/attendees
//   Lista de convocados con estado de asistencia.
//   ?format=xlsx  → descarga la planilla de cumplimiento.
//
// PUT /api/agenda/events/[id]/attendees
//   Reemplaza la lista completa de invitados. Body: { user_ids: string[] }.
//   Solo accesible para: el creador del evento, press_admin.
//
// Solo GET accesible para: el creador del evento, ejecutiva, press_admin.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import * as XLSX from 'xlsx';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const STATUS_LABEL: Record<string, string> = {
  invited:     'Sin responder',
  going:       'Asiste',
  not_going:   'No asiste',
  maybe:       'Tal vez',
  no_response: 'Sin respuesta',
  on_leave:    'De licencia',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: userId, role } = session.user;
  const eventId = params.id;

  // Verificar acceso al evento
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { id: true, title: true, type: true, status: true, created_by: true, starts_at: true },
  });

  if (!event) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });

  const isOwner = event.created_by === userId;
  const isAdminOrExec = role === 'press_admin' || role === 'executive';
  if (!isOwner && !isAdminOrExec) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  // Cargar convocados con nombre del usuario
  const rows = await db
    .select({
      id: schema.eventAttendees.id,
      user_id: schema.eventAttendees.user_id,
      status: schema.eventAttendees.status,
      responded_at: schema.eventAttendees.responded_at,
      response_source: schema.eventAttendees.response_source,
      full_name: schema.users.full_name,
      role: schema.users.role,
      position: schema.users.position,
    })
    .from(schema.eventAttendees)
    .leftJoin(schema.users, eq(schema.eventAttendees.user_id, schema.users.id))
    .where(eq(schema.eventAttendees.event_id, eventId))
    .orderBy(schema.users.full_name);

  const format = req.nextUrl.searchParams.get('format');

  if (format === 'xlsx') {
    const ART_TZ = 'America/Argentina/Buenos_Aires';
    const eventDateStr = event.starts_at.toLocaleDateString('es-AR', {
      timeZone: ART_TZ,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const sheetData = [
      ['Evento', event.title],
      ['Fecha', eventDateStr],
      ['Estado del evento', event.status],
      [],
      ['Nombre', 'Cargo', 'Estado asistencia', 'Canal de respuesta', 'Respondido'],
      ...rows.map(r => [
        r.full_name ?? '—',
        r.position ?? '—',
        STATUS_LABEL[r.status] ?? r.status,
        r.response_source ?? '—',
        r.responded_at
          ? r.responded_at.toLocaleString('es-AR', { timeZone: ART_TZ })
          : '—',
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const filename = `asistencia-${eventId.slice(0, 8)}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({ attendees: rows });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: userId, role } = session.user;

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, params.id),
    columns: { id: true, created_by: true, status: true },
  });

  if (!event) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });
  if (event.created_by !== userId && role !== 'press_admin') {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  if (event.status === 'cancelled' || event.status === 'done') {
    return NextResponse.json({ error: 'No se puede editar un evento cancelado o finalizado' }, { status: 400 });
  }

  const body = await req.json() as { user_ids?: unknown };
  if (!Array.isArray(body.user_ids)) {
    return NextResponse.json({ error: 'user_ids debe ser un array' }, { status: 400 });
  }
  const newUserIds = (body.user_ids as unknown[]).filter((v): v is string => typeof v === 'string');

  const existing = await db
    .select({ user_id: schema.eventAttendees.user_id })
    .from(schema.eventAttendees)
    .where(eq(schema.eventAttendees.event_id, params.id));

  const existingSet = new Set(existing.map(r => r.user_id));
  const newSet = new Set(newUserIds);

  const toRemove = Array.from(existingSet).filter(uid => !newSet.has(uid));
  const toAdd = newUserIds.filter(uid => !existingSet.has(uid));

  if (toRemove.length > 0) {
    await db
      .delete(schema.eventAttendees)
      .where(
        and(
          eq(schema.eventAttendees.event_id, params.id),
          inArray(schema.eventAttendees.user_id, toRemove),
        ),
      );
  }

  if (toAdd.length > 0) {
    await db.insert(schema.eventAttendees).values(
      toAdd.map(uid => ({
        event_id: params.id,
        user_id: uid,
        status: 'invited' as const,
      })),
    );
  }

  return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length });
}
