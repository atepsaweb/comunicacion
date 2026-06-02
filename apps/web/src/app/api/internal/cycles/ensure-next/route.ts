/**
 * POST /api/internal/cycles/ensure-next
 *
 * Crea el ciclo para la semana SIGUIENTE al ciclo más reciente en DB.
 * Se llama desde weekly-cycle-close inmediatamente después de cerrar,
 * para que nunca haya un gap sin ciclo activo (el siguiente ciclo
 * queda en "pending" y lo abre el endpoint /open).
 *
 * Si el siguiente ciclo ya existe, devuelve el existente (idempotente).
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

function getISOWeekAndYear(date: Date): { year: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), isoWeek };
}

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

  // Ciclo más reciente en DB
  const latest = await db.query.weeklyCycles.findFirst({
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    columns: { starts_at: true },
  });

  // Lunes de la semana siguiente: starts_at del último ciclo + 7 días
  // Si no hay ningún ciclo, usamos la semana actual
  const baseDate = latest
    ? new Date(latest.starts_at.getTime() + 7 * 24 * 60 * 60 * 1000)
    : new Date();

  const { year, isoWeek } = getISOWeekAndYear(baseDate);

  // Idempotente: si ya existe, retornarlo
  const existing = await db.query.weeklyCycles.findFirst({
    where: and(
      eq(schema.weeklyCycles.year, year),
      eq(schema.weeklyCycles.iso_week, isoWeek),
    ),
    columns: { id: true, status: true },
  });

  if (existing) {
    return NextResponse.json({ cycleId: existing.id, created: false, isoWeek, year, status: existing.status });
  }

  // Crear el ciclo
  const mondayUTC = isoWeekToMondayUTC(year, isoWeek);

  const startsAt  = new Date(mondayUTC); startsAt.setUTCHours(3, 0, 0, 0);
  const endsAt    = new Date(mondayUTC); endsAt.setUTCDate(mondayUTC.getUTCDate() + 7); endsAt.setUTCHours(2, 59, 59, 999);
  const triggerAt = new Date(mondayUTC); triggerAt.setUTCDate(mondayUTC.getUTCDate() + 3); triggerAt.setUTCHours(13, 0, 0, 0);
  const reminderAt = new Date(mondayUTC); reminderAt.setUTCDate(mondayUTC.getUTCDate() + 4); reminderAt.setUTCHours(15, 0, 0, 0);
  const closesAt  = new Date(mondayUTC); closesAt.setUTCDate(mondayUTC.getUTCDate() + 4); closesAt.setUTCHours(21, 0, 0, 0);

  const [cycle] = await db
    .insert(schema.weeklyCycles)
    .values({ year, iso_week: isoWeek, starts_at: startsAt, ends_at: endsAt,
              trigger_at: triggerAt, reminder_at: reminderAt, closes_at: closesAt,
              status: 'pending' })
    .returning({ id: schema.weeklyCycles.id, status: schema.weeklyCycles.status });

  return NextResponse.json({ cycleId: cycle.id, created: true, isoWeek, year, status: cycle.status });
}
