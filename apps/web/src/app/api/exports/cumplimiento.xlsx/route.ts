import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

type CellStatus = 'Reportó' | 'Pausa' | 'Licencia' | 'Sin reporte';

function getCycleWeekLabel(isoWeek: number, year: number): string {
  return `S${isoWeek}/${String(year).slice(2)}`;
}

function getCycleDateRange(startsAt: Date): { startDate: string; endDate: string } {
  const startDate = startsAt.toISOString().split('T')[0]!;
  const endDt = new Date(startsAt);
  endDt.setUTCDate(startsAt.getUTCDate() + 6);
  return { startDate, endDate: endDt.toISOString().split('T')[0]! };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin' && session.user.role !== 'executive') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Últimos 12 ciclos cerrados
  const cycles = await db.query.weeklyCycles.findMany({
    where: inArray(schema.weeklyCycles.status, ['closed', 'processed', 'published']),
    columns: { id: true, iso_week: true, year: true, starts_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 12,
  });

  // Usuarios activos (secretary/executive)
  const users = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true, full_name: true },
    orderBy: [schema.users.full_name],
  });

  const cycleIds = cycles.map(c => c.id);
  const userIds = users.map(u => u.id);

  // Reportes de esos ciclos
  const reports =
    cycleIds.length > 0 && userIds.length > 0
      ? await db.query.reports.findMany({
          where: and(
            inArray(schema.reports.cycle_id, cycleIds),
            inArray(schema.reports.user_id, userIds),
          ),
          columns: { user_id: true, cycle_id: true, status: true },
        })
      : [];

  // report lookup: `${userId}:${cycleId}` → status
  const reportMap = new Map<string, string>();
  for (const r of reports) {
    reportMap.set(`${r.user_id}:${r.cycle_id}`, r.status);
  }

  // Ausencias que solapan el rango completo
  const cycleRanges = cycles.map(c => ({
    id: c.id,
    ...getCycleDateRange(c.starts_at),
  }));
  const minDate = cycleRanges[cycleRanges.length - 1]?.startDate ?? '';
  const maxDate = cycleRanges[0]?.endDate ?? '';

  const absences =
    minDate && maxDate
      ? await db.query.absences.findMany({
          where: and(
            lte(schema.absences.starts_on, maxDate),
            gte(schema.absences.ends_on, minDate),
            inArray(schema.absences.user_id, userIds),
          ),
          columns: { user_id: true, starts_on: true, ends_on: true },
        })
      : [];

  function wasOnLeave(userId: string, cycleStart: string, cycleEnd: string): boolean {
    return absences.some(
      a => a.user_id === userId && a.starts_on <= cycleEnd && a.ends_on >= cycleStart,
    );
  }

  function cellStatus(userId: string, cycleId: string, cycleStart: string, cycleEnd: string): CellStatus {
    const status = reportMap.get(`${userId}:${cycleId}`);
    if (!status) {
      if (wasOnLeave(userId, cycleStart, cycleEnd)) return 'Licencia';
      return 'Sin reporte';
    }
    if (status === 'on_leave') return 'Licencia';
    if (status === 'paused') return 'Pausa';
    if (status === 'no_report') return 'Sin reporte';
    return 'Reportó';
  }

  // Construir filas
  const weekHeaders = cycles.map(c => getCycleWeekLabel(c.iso_week, c.year));
  const headerRow = ['Apellido y nombre', ...weekHeaders];

  const dataRows: (string | number)[][] = users.map(u => {
    const cells: CellStatus[] = cycleRanges.map(cr =>
      cellStatus(u.id, cr.id, cr.startDate, cr.endDate),
    );
    return [u.full_name, ...cells];
  });

  // Fila de totales
  const totalRow: (string | number)[] = ['TOTALES'];
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i]!;
    const cr = cycleRanges[i]!;
    const reported = users.filter(u => {
      const s = cellStatus(u.id, cycle.id, cr.startDate, cr.endDate);
      return s === 'Reportó';
    }).length;
    totalRow.push(`${reported}/${users.length}`);
  }

  const wsData = [headerRow, ...dataRows, totalRow];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Ancho de columnas
  ws['!cols'] = [{ wch: 28 }, ...cycles.map(() => ({ wch: 12 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cumplimiento');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  // Nombre de archivo con semana del ciclo más reciente
  const latestCycle = cycles[0];
  const filename = latestCycle
    ? `cumplimiento-semana-${latestCycle.iso_week}-${latestCycle.year}.xlsx`
    : 'cumplimiento.xlsx';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
