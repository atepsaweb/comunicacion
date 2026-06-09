// GET /api/ical/[token]
// Feed iCal público para suscripción en Google Calendar / Apple Calendar / Outlook.
// El token es la única protección de acceso: no se requiere sesión.
//
// Responde con Content-Type: text/calendar y cabeceras de cache (15 min, ETag).
// El scope del token determina qué eventos se incluyen:
//   all          → eventos propios (personal) + secretariat/mobilization confirmados/done
//   secretariat  → solo secretariat/mobilization confirmados/done (sin personales)
//   personal     → solo eventos personales del usuario
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, inArray, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { buildIcalFeed, type IcalEvent } from '@/lib/ical';

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  // Verificar token
  const tokenRow = await db.query.icalTokens.findFirst({
    where: and(
      eq(schema.icalTokens.token, params.token),
      isNull(schema.icalTokens.revoked_at),
    ),
    columns: { id: true, user_id: true, scope: true },
  });

  if (!tokenRow) {
    return new NextResponse('Feed no encontrado o token inválido.', { status: 404 });
  }

  // Registrar acceso (best effort)
  db.update(schema.icalTokens).set({ last_accessed_at: new Date() })
    .where(eq(schema.icalTokens.id, tokenRow.id))
    .catch(() => undefined);

  const { user_id: userId, scope } = tokenRow;

  // Construir filtro de visibilidad según scope
  const notCancelled = ne(schema.events.status, 'cancelled' as const);
  const notPending = ne(schema.events.status, 'pending_confirmation' as const);

  let visibilityFilter;
  if (scope === 'personal') {
    visibilityFilter = and(
      notPending,
      notCancelled,
      eq(schema.events.created_by, userId),
      eq(schema.events.type, 'personal' as const),
    );
  } else if (scope === 'secretariat') {
    visibilityFilter = and(
      notPending,
      notCancelled,
      inArray(schema.events.type, ['secretariat', 'mobilization'] as const),
      inArray(schema.events.status, ['confirmed', 'done'] as const),
    );
  } else {
    // all
    visibilityFilter = and(
      notPending,
      notCancelled,
      or(
        and(
          eq(schema.events.type, 'personal' as const),
          eq(schema.events.created_by, userId),
        ),
        and(
          inArray(schema.events.type, ['secretariat', 'mobilization'] as const),
          inArray(schema.events.status, ['confirmed', 'done'] as const),
        ),
      ),
    );
  }

  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      description_md: schema.events.description_md,
      location: schema.events.location,
      starts_at: schema.events.starts_at,
      ends_at: schema.events.ends_at,
      all_day: schema.events.all_day,
      status: schema.events.status,
      updated_at: schema.events.updated_at,
    })
    .from(schema.events)
    .where(visibilityFilter)
    .orderBy(schema.events.starts_at);

  const now = new Date();
  const events: IcalEvent[] = rows.map(r => ({
    uid: r.id,
    summary: r.title,
    description: r.description_md,
    location: r.location,
    dtstart: r.starts_at,
    dtend: r.ends_at,
    allDay: r.all_day,
    status: r.status as IcalEvent['status'],
    lastModified: r.updated_at,
    dtstamp: now,
  }));

  const scopeLabels: Record<string, string> = {
    all: 'Agenda ATEPSA',
    secretariat: 'Secretariado ATEPSA',
    personal: 'Agenda personal ATEPSA',
  };

  const icsContent = buildIcalFeed(scopeLabels[scope] ?? 'Agenda ATEPSA', events);

  // ETag basado en el updated_at más reciente
  const latestUpdate = rows.reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max),
    new Date(0),
  );
  const etag = `"${latestUpdate.getTime().toString(36)}"`;

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304 });
  }

  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="agenda-atepsa.ics"',
      'Cache-Control': 'public, max-age=900', // 15 min
      ETag: etag,
    },
  });
}
