// Endpoint para detectar secretarios que llevan 2 o más semanas consecutivas sin reportar.
// n8n puede llamarlo semanalmente para que Julián identifique quién necesita un seguimiento personal.
// Un secretario "flagged" es quien no reportó en 2 de los últimos 2 ciclos cerrados
// Y que tampoco tenía ausencia registrada en esos períodos (no es excusa válida).
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Últimos 2 ciclos cerrados
  const closedCycles = await db.query.weeklyCycles.findMany({
    where: inArray(schema.weeklyCycles.status, ['closed', 'processed', 'published']),
    columns: { id: true, iso_week: true, year: true, starts_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 2,
  });

  if (closedCycles.length < 2) {
    return NextResponse.json({ users: [], note: 'not_enough_cycles' });
  }

  // Usuarios activos con rol secretary o executive
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true, full_name: true },
  });

  const cycleIds = closedCycles.map(c => c.id);

  // Reportes en esos 2 ciclos
  const reports = await db.query.reports.findMany({
    where: inArray(schema.reports.cycle_id, cycleIds),
    columns: { user_id: true, cycle_id: true, status: true },
  });

  // userId → Set de cycle_id donde sí reportó (status != 'no_report')
  const reportedMap = new Map<string, Set<string>>();
  for (const r of reports) {
    if (r.status !== 'no_report') {
      if (!reportedMap.has(r.user_id)) reportedMap.set(r.user_id, new Set());
      reportedMap.get(r.user_id)!.add(r.cycle_id);
    }
  }

  // Rangos de fecha de cada ciclo (lunes–domingo)
  const cycleRanges = closedCycles.map(c => {
    const startDate = c.starts_at.toISOString().split('T')[0]!;
    const endDt = new Date(c.starts_at);
    endDt.setUTCDate(c.starts_at.getUTCDate() + 6);
    return { id: c.id, startDate, endDate: endDt.toISOString().split('T')[0]! };
  });

  const minDate = cycleRanges[cycleRanges.length - 1]!.startDate;
  const maxDate = cycleRanges[0]!.endDate;

  // Ausencias que solapan alguno de los 2 ciclos
  const absences = await db.query.absences.findMany({
    where: and(
      lte(schema.absences.starts_on, maxDate),
      gte(schema.absences.ends_on, minDate),
    ),
    columns: { user_id: true, starts_on: true, ends_on: true },
  });

  function wasOnLeave(userId: string, cycleStart: string, cycleEnd: string): boolean {
    return absences.some(
      a => a.user_id === userId && a.starts_on <= cycleEnd && a.ends_on >= cycleStart,
    );
  }

  const flagged: Array<{ userId: string; fullName: string; weeksMissing: number }> = [];

  for (const user of activeUsers) {
    let missedCount = 0;
    for (const cr of cycleRanges) {
      if (wasOnLeave(user.id, cr.startDate, cr.endDate)) continue;
      const reported = reportedMap.get(user.id)?.has(cr.id) ?? false;
      if (!reported) missedCount++;
    }
    if (missedCount >= 2) {
      flagged.push({ userId: user.id, fullName: user.full_name, weeksMissing: missedCount });
    }
  }

  return NextResponse.json({ users: flagged, cyclesChecked: closedCycles.length });
}
