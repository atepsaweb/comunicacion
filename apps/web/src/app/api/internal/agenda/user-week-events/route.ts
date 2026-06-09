// GET /api/internal/agenda/user-week-events?userId=&cycleId=
// Devuelve los eventos relevantes para un usuario durante el rango de un ciclo semanal.
// Lo usa weekly-trigger-send para enriquecer el mensaje del jueves con "esta semana tenías agendado".
//
// Visibilidad:
//   - Eventos personales del propio usuario (created_by = userId)
//   - Todos los eventos secretariat/mobilization confirmed/done de la semana
//     (relevantes para todo el Secretariado, independientemente de si el usuario fue convocado)
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lte, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const userId = searchParams.get('userId');
  const cycleId = searchParams.get('cycleId');

  if (!userId || !cycleId) {
    return NextResponse.json({ error: 'userId y cycleId son requeridos' }, { status: 400 });
  }

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { starts_at: true, ends_at: true },
  });

  if (!cycle) {
    return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
  }

  const events = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      starts_at: schema.events.starts_at,
      all_day: schema.events.all_day,
      location: schema.events.location,
    })
    .from(schema.events)
    .where(
      and(
        gte(schema.events.starts_at, cycle.starts_at),
        lte(schema.events.starts_at, cycle.ends_at),
        inArray(schema.events.status, ['confirmed', 'done']),
        ne(schema.events.status, 'cancelled' as const),
        or(
          // Eventos personales del usuario
          eq(schema.events.created_by, userId),
          // Todos los eventos grupales (secretariat/mobilization) visibles a todos
          inArray(schema.events.type, ['secretariat', 'mobilization']),
        ),
      ),
    )
    .orderBy(schema.events.starts_at)
    .limit(10); // máximo 10 eventos en el mensaje para no saturar

  return NextResponse.json({ events, cycleId, userId });
}
