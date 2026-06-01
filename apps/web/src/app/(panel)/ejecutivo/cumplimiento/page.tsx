import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { DownloadXlsxButton } from './download-button';

type CellStatus = 'reported' | 'paused' | 'on_leave' | 'no_report';

const CELL_STYLES: Record<CellStatus, string> = {
  reported: 'bg-green-600 text-white',
  paused: 'bg-yellow-600 text-white',
  on_leave: 'bg-zinc-400 text-white',
  no_report: 'bg-red-600 text-white',
};

const CELL_LABELS: Record<CellStatus, string> = {
  reported: 'Sí',
  paused: 'Pausa',
  on_leave: 'Lic.',
  no_report: '—',
};

function getCycleDateRange(startsAt: Date): { startDate: string; endDate: string } {
  const startDate = startsAt.toISOString().split('T')[0]!;
  const endDt = new Date(startsAt);
  endDt.setUTCDate(startsAt.getUTCDate() + 6);
  return { startDate, endDate: endDt.toISOString().split('T')[0]! };
}

function resolveCellStatus(
  userId: string,
  cycleId: string,
  cycleStart: string,
  cycleEnd: string,
  reportMap: Map<string, string>,
  absences: Array<{ user_id: string; starts_on: string; ends_on: string }>,
): CellStatus {
  const status = reportMap.get(`${userId}:${cycleId}`);
  if (!status) {
    const onLeave = absences.some(
      a => a.user_id === userId && a.starts_on <= cycleEnd && a.ends_on >= cycleStart,
    );
    return onLeave ? 'on_leave' : 'no_report';
  }
  if (status === 'on_leave') return 'on_leave';
  if (status === 'paused') return 'paused';
  if (status === 'no_report') return 'no_report';
  return 'reported';
}

export default async function CumplimientoPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin' && session.user.role !== 'executive') notFound();

  // Últimos 12 ciclos cerrados
  const cycles = await db.query.weeklyCycles.findMany({
    where: inArray(schema.weeklyCycles.status, ['closed', 'processed', 'published']),
    columns: { id: true, iso_week: true, year: true, starts_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 12,
  });

  // Usuarios activos (secretary/executive) ordenados por nombre
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

  const reportMap = new Map<string, string>();
  for (const r of reports) {
    reportMap.set(`${r.user_id}:${r.cycle_id}`, r.status);
  }

  const cycleRanges = cycles.map(c => ({ id: c.id, ...getCycleDateRange(c.starts_at) }));
  const minDate = cycleRanges[cycleRanges.length - 1]?.startDate ?? '';
  const maxDate = cycleRanges[0]?.endDate ?? '';

  const absences =
    minDate && maxDate && userIds.length > 0
      ? await db.query.absences.findMany({
          where: and(
            lte(schema.absences.starts_on, maxDate),
            gte(schema.absences.ends_on, minDate),
            inArray(schema.absences.user_id, userIds),
          ),
          columns: { user_id: true, starts_on: true, ends_on: true },
        })
      : [];

  if (cycles.length === 0) {
    return (
      <div className="max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold text-zinc-900">Cumplimiento</h1>
        <p className="text-zinc-500 text-sm">No hay ciclos cerrados aún.</p>
      </div>
    );
  }

  // Calcular totales por ciclo
  const cycleTotals = cycleRanges.map(cr => {
    let reported = 0;
    for (const u of users) {
      const s = resolveCellStatus(u.id, cr.id, cr.startDate, cr.endDate, reportMap, absences);
      if (s === 'reported') reported++;
    }
    return { reported, total: users.length };
  });

  return (
    <div className="max-w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Cumplimiento</h1>
          <p className="text-zinc-500 mt-1 text-sm">Matriz de reporte — últimas {cycles.length} semanas cerradas.</p>
        </div>
        <DownloadXlsxButton />
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-green-600" />Reportó
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-yellow-600" />Pausa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-zinc-400" />Licencia
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-600" />Sin reporte
        </span>
      </div>

      {/* Mobile: una card por secretario con sus últimas semanas */}
      <div className="md:hidden space-y-2">
        {users.map(u => (
          <div key={u.id} className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="text-sm font-medium text-zinc-800 mb-2">{u.full_name}</p>
            <div className="flex flex-wrap gap-1.5">
              {cycleRanges.map(cr => {
                const status = resolveCellStatus(u.id, cr.id, cr.startDate, cr.endDate, reportMap, absences);
                const cycle = cycles.find(c => c.id === cr.id)!;
                return (
                  <span
                    key={cr.id}
                    className={`inline-flex items-center justify-center px-2 h-6 rounded text-xs font-medium ${CELL_STYLES[status]}`}
                    title={`Semana ${cycle.iso_week} — ${CELL_LABELS[status]}`}
                  >
                    S{cycle.iso_week}
                  </span>
                );
              })}
            </div>
          </div>
        ))}

        {/* Totales mobile */}
        <div className="rounded-lg border-2 border-zinc-300 bg-zinc-100 p-3">
          <p className="text-sm font-semibold text-zinc-700 mb-2">Totales por semana</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-700">
            {cycles.map((c, i) => (
              <span key={c.id} className="tabular-nums">
                S{c.iso_week}: {cycleTotals[i]!.reported}/{cycleTotals[i]!.total}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="text-left px-4 py-3 font-medium text-zinc-700 min-w-[180px] sticky left-0 bg-zinc-50 z-10">
                Secretario/a
              </th>
              {cycles.map(c => (
                <th
                  key={c.id}
                  className="px-3 py-3 font-medium text-zinc-700 text-center min-w-[56px]"
                >
                  S{c.iso_week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, uIdx) => (
              <tr
                key={u.id}
                className={uIdx % 2 === 0 ? 'bg-white' : 'bg-zinc-50'}
              >
                <td className={`px-4 py-2.5 text-zinc-800 font-medium sticky left-0 z-10 ${uIdx % 2 === 0 ? 'bg-white' : 'bg-zinc-50'}`}>
                  {u.full_name}
                </td>
                {cycleRanges.map(cr => {
                  const status = resolveCellStatus(u.id, cr.id, cr.startDate, cr.endDate, reportMap, absences);
                  return (
                    <td key={cr.id} className="px-3 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-medium ${CELL_STYLES[status]}`}
                      >
                        {CELL_LABELS[status]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Fila de totales */}
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold">
              <td className="px-4 py-2.5 text-zinc-700 sticky left-0 bg-zinc-100 z-10">Totales</td>
              {cycleTotals.map((t, i) => (
                <td key={i} className="px-3 py-2.5 text-center text-zinc-700 text-xs">
                  {t.reported}/{t.total}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
