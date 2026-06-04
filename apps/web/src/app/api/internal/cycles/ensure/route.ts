// Endpoint para crear el ciclo semanal si no existe todavía.
// n8n llama a este endpoint al comienzo de cada semana para asegurarse
// de que haya un ciclo creado. Si ya existe para esa semana, no hace nada.
// Los horarios están calculados en hora argentina (ART = UTC-3):
//   - Apertura: el ciclo cubre de lunes a domingo
//   - Trigger: jueves 10:00 ART (se envía el mensaje inicial a los secretarios)
//   - Recordatorio: viernes 12:00 ART (a los que no reportaron)
//   - Cierre: sábado 10:00 ART (deja de aceptar mensajes)
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

// Diferencia en milisegundos entre UTC y hora argentina (ART = UTC-3)
const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

function getISOWeekAndYear(date: Date): { year: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), isoWeek };
}

// Returns Monday 00:00 UTC of the given ISO week (used as base for calculations)
function isoWeekToMondayUTC(year: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use ART "now" to determine current week (Argentina might be in a different day than UTC)
  const nowART = new Date(Date.now() - ART_OFFSET_MS);
  const { year, isoWeek } = getISOWeekAndYear(nowART);

  const existing = await db.query.weeklyCycles.findFirst({
    where: and(
      eq(schema.weeklyCycles.year, year),
      eq(schema.weeklyCycles.iso_week, isoWeek),
    ),
    columns: { id: true, status: true, iso_week: true, year: true },
  });

  if (existing) {
    return NextResponse.json({ cycleId: existing.id, created: false, isoWeek, year, status: existing.status });
  }

  // Compute cycle timestamps — everything expressed in UTC, derived from ART schedule
  const mondayUTC = isoWeekToMondayUTC(year, isoWeek);

  // starts_at = Monday 00:00 ART = Monday 03:00 UTC
  const startsAt = new Date(mondayUTC);
  startsAt.setUTCHours(3, 0, 0, 0);

  // ends_at = Sunday 23:59:59 ART = next Monday 02:59:59 UTC
  const endsAt = new Date(mondayUTC);
  endsAt.setUTCDate(mondayUTC.getUTCDate() + 7);
  endsAt.setUTCHours(2, 59, 59, 999);

  // trigger_at = Thursday 10:00 ART = Thursday 13:00 UTC
  const triggerAt = new Date(mondayUTC);
  triggerAt.setUTCDate(mondayUTC.getUTCDate() + 3);
  triggerAt.setUTCHours(13, 0, 0, 0);

  // reminder_at = Friday 12:00 ART = Friday 15:00 UTC
  const reminderAt = new Date(mondayUTC);
  reminderAt.setUTCDate(mondayUTC.getUTCDate() + 4);
  reminderAt.setUTCHours(15, 0, 0, 0);

  // closes_at = Saturday 10:00 ART = Saturday 13:00 UTC
  const closesAt = new Date(mondayUTC);
  closesAt.setUTCDate(mondayUTC.getUTCDate() + 5);
  closesAt.setUTCHours(13, 0, 0, 0);

  const [cycle] = await db
    .insert(schema.weeklyCycles)
    .values({
      year,
      iso_week: isoWeek,
      starts_at: startsAt,
      ends_at: endsAt,
      trigger_at: triggerAt,
      reminder_at: reminderAt,
      closes_at: closesAt,
      status: 'pending',
    })
    .returning({ id: schema.weeklyCycles.id, status: schema.weeklyCycles.status });

  return NextResponse.json({ cycleId: cycle.id, created: true, isoWeek, year, status: cycle.status });
}
