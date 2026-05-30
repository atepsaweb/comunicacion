import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function EstadisticasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin' && session.user.role !== 'executive') notFound();

  // Últimos 12 ciclos cerrados
  const cycles = await db.query.weeklyCycles.findMany({
    where: inArray(schema.weeklyCycles.status, ['closed', 'processed', 'published']),
    columns: { id: true, iso_week: true, year: true, starts_at: true, status: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 12,
  });

  // Ciclo actual (open o el más reciente)
  const currentCycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.status, 'open'),
    columns: { id: true, iso_week: true, year: true, status: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
  });

  // Total usuarios activos (secretary/executive)
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true },
  });
  const totalActive = activeUsers.length;

  const cycleIds = cycles.map(c => c.id);

  // Reportes de los últimos 12 ciclos
  const reports =
    cycleIds.length > 0
      ? await db.query.reports.findMany({
          where: inArray(schema.reports.cycle_id, cycleIds),
          columns: { id: true, user_id: true, cycle_id: true, status: true },
        })
      : [];

  // Items de esos reportes
  const reportIds = reports.map(r => r.id);
  const items =
    reportIds.length > 0
      ? await db.query.reportItems.findMany({
          where: inArray(schema.reportItems.report_id, reportIds),
          columns: { report_id: true, category: true },
        })
      : [];

  // Panel 1: items por categoría (top 5)
  const categoryCounts = new Map<string, number>();
  for (const item of items) {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
  }
  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCategoryCount = topCategories[0]?.[1] ?? 1;

  // Panel 2: evolución semanal de participación (orden cronológico, más viejo primero)
  const cyclesChronological = [...cycles].reverse();
  const weeklyParticipation = cyclesChronological.map(c => {
    const cycleReports = reports.filter(r => r.cycle_id === c.id);
    const reported = cycleReports.filter(r =>
      r.status !== 'no_report' && r.status !== 'paused' && r.status !== 'on_leave',
    ).length;
    return {
      label: `S${c.iso_week}`,
      reported,
      total: totalActive,
    };
  });
  const maxParticipation = Math.max(...weeklyParticipation.map(w => w.reported), 1);

  // Panel 3: resumen del ciclo actual
  let currentSummary: {
    isoWeek: number;
    year: number;
    reported: number;
    noReport: number;
    onLeave: number;
    paused: number;
    total: number;
  } | null = null;

  if (currentCycle) {
    const currentReports = await db.query.reports.findMany({
      where: eq(schema.reports.cycle_id, currentCycle.id),
      columns: { status: true },
    });
    const reported = currentReports.filter(r =>
      r.status !== 'no_report' && r.status !== 'paused' && r.status !== 'on_leave',
    ).length;
    const noReport = currentReports.filter(r => r.status === 'no_report').length;
    const onLeave = currentReports.filter(r => r.status === 'on_leave').length;
    const paused = currentReports.filter(r => r.status === 'paused').length;
    currentSummary = {
      isoWeek: currentCycle.iso_week,
      year: currentCycle.year,
      reported,
      noReport: Math.max(0, totalActive - reported - noReport - onLeave - paused) + noReport,
      onLeave,
      paused,
      total: totalActive,
    };
  }

  if (cycles.length === 0) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-zinc-900">Estadísticas</h1>
        <p className="text-zinc-500 text-sm">No hay ciclos cerrados aún.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Estadísticas</h1>
        <p className="text-zinc-500 mt-1 text-sm">Últimas {cycles.length} semanas cerradas.</p>
      </div>

      {/* Panel 3: Resumen ciclo actual */}
      {currentSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo actual — Semana {currentSummary.isoWeek}/{currentSummary.year}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatBox label="Reportaron" value={currentSummary.reported} total={currentSummary.total} color="text-green-700" />
              <StatBox label="Sin reporte" value={currentSummary.noReport} total={currentSummary.total} color="text-red-700" />
              <StatBox label="Con licencia" value={currentSummary.onLeave} total={currentSummary.total} color="text-zinc-500" />
              <StatBox label="En pausa" value={currentSummary.paused} total={currentSummary.total} color="text-yellow-700" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Panel 2: Evolución semanal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolución semanal de participación</CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyParticipation.length === 0 ? (
            <p className="text-sm text-zinc-400">Sin datos.</p>
          ) : (
            <div className="space-y-2">
              {weeklyParticipation.map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 w-10 shrink-0">{w.label}</span>
                  <div className="flex-1 h-6 bg-zinc-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-zinc-700 rounded transition-all"
                      style={{ width: `${Math.round((w.reported / maxParticipation) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-600 w-10 text-right shrink-0">
                    {w.reported}/{w.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel 1: Items por categoría */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 5 categorías de ítems reportados</CardTitle>
        </CardHeader>
        <CardContent>
          {topCategories.length === 0 ? (
            <p className="text-sm text-zinc-400">Sin ítems registrados.</p>
          ) : (
            <div className="space-y-2">
              {topCategories.map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 w-40 shrink-0 truncate">{cat}</span>
                  <div className="flex-1 h-6 bg-zinc-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-zinc-700 rounded flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${Math.round((count / maxCategoryCount) * 100)}%` }}
                    >
                      <span className="text-xs text-white font-medium">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-4 py-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      <p className="text-xs text-zinc-400">de {total}</p>
    </div>
  );
}
