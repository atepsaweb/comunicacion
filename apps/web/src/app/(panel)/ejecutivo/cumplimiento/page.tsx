// Página de cumplimiento: quién participó en las últimas 3 semanas.
// Solo visible para roles executive y press_admin.
//
// Lógica de estado por celda (basada en mensajes recibidos, no en el pipeline de extracción):
//   🟢 Reportó         → mandó al menos un mensaje con intent=report/report_followup_reply
//   🟡 Esta semana paso → mandó "esta semana paso" (intent=weekly_pause), sin mensajes de report
//   ⬜ Licencia        → tiene ausencia registrada que cubre ese ciclo
//   🔴 Sin reporte     → no mandó nada relevante
//   —  Próxima         → ciclo pending, todavía no empezó
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { DownloadXlsxButton } from './download-button';

type CellStatus = 'reported' | 'paused' | 'on_leave' | 'no_report' | 'pending';

const CELL_CONFIG: Record<CellStatus, { bg: string; text: string; label: string; tooltip: string }> = {
  reported:  { bg: 'bg-green-600',  text: 'text-white',    label: 'Sí',    tooltip: 'Reportó'           },
  paused:    { bg: 'bg-yellow-500', text: 'text-white',    label: 'Paso',  tooltip: 'Esta semana paso'  },
  on_leave:  { bg: 'bg-zinc-400',   text: 'text-white',    label: 'Lic.',  tooltip: 'Licencia'          },
  no_report: { bg: 'bg-red-600',    text: 'text-white',    label: '—',     tooltip: 'Sin reporte'       },
  pending:   { bg: 'bg-zinc-100',   text: 'text-zinc-400', label: '·',     tooltip: 'Ciclo no iniciado' },
};

function getCycleDateRange(startsAt: Date): { startDate: string; endDate: string } {
  const startDate = startsAt.toISOString().split('T')[0]!;
  const endDt = new Date(startsAt);
  endDt.setUTCDate(startsAt.getUTCDate() + 6);
  return { startDate, endDate: endDt.toISOString().split('T')[0]! };
}

export default async function CumplimientoPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin' && session.user.role !== 'executive') notFound();

  // Últimas 3 semanas — incluye pending para mostrar la próxima
  const cycles = await db.query.weeklyCycles.findMany({
    columns: { id: true, iso_week: true, year: true, status: true, starts_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 3,
  });

  // Todos los usuarios activos que reportan (secretary + executive + press_admin)
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive', 'press_admin']),
    ),
    columns: { id: true, full_name: true },
    orderBy: [schema.users.full_name],
  });

  const userIds = activeUsers.map(u => u.id);
  const nonPendingCycles = cycles.filter(c => c.status !== 'pending');
  const nonPendingIds = nonPendingCycles.map(c => c.id);

  // Mensajes relevantes: solo intent=report/followup/pause, no descartados
  const relevantMessages =
    nonPendingIds.length > 0 && userIds.length > 0
      ? await db.query.inboundMessages.findMany({
          where: and(
            inArray(schema.inboundMessages.cycle_id, nonPendingIds),
            inArray(schema.inboundMessages.user_id, userIds),
            inArray(schema.inboundMessages.intent, [
              'report',
              'report_followup_reply',
              'weekly_pause',
            ] as ('report' | 'report_followup_reply' | 'weekly_pause')[]),
            isNull(schema.inboundMessages.discarded_at),
          ),
          columns: { user_id: true, cycle_id: true, intent: true },
        })
      : [];

  // Índice: "userId:cycleId" → { hasReport, hasPause }
  const msgIndex = new Map<string, { hasReport: boolean; hasPause: boolean }>();
  for (const m of relevantMessages) {
    if (!m.user_id || !m.cycle_id || !m.intent) continue;
    const key = `${m.user_id}:${m.cycle_id}`;
    const prev = msgIndex.get(key) ?? { hasReport: false, hasPause: false };
    if (m.intent === 'report' || m.intent === 'report_followup_reply') prev.hasReport = true;
    else if (m.intent === 'weekly_pause') prev.hasPause = true;
    msgIndex.set(key, prev);
  }

  // Ausencias para licencias
  const cycleRanges = nonPendingCycles.map(c => ({ id: c.id, ...getCycleDateRange(c.starts_at) }));
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

  function resolveCellStatus(userId: string, cycle: (typeof cycles)[0]): CellStatus {
    if (cycle.status === 'pending') return 'pending';

    const { startDate, endDate } = getCycleDateRange(cycle.starts_at);
    const onLeave = absences.some(
      a => a.user_id === userId && a.starts_on <= endDate && a.ends_on >= startDate,
    );
    if (onLeave) return 'on_leave';

    const summary = msgIndex.get(`${userId}:${cycle.id}`);
    if (!summary) return 'no_report';
    if (summary.hasReport) return 'reported';
    if (summary.hasPause) return 'paused';
    return 'no_report';
  }

  // Estadísticas por ciclo
  const cycleStats = cycles.map(cycle => {
    let reported = 0, paused = 0, onLeave = 0, noReport = 0;
    for (const u of activeUsers) {
      const s = resolveCellStatus(u.id, cycle);
      if (s === 'reported') reported++;
      else if (s === 'paused') paused++;
      else if (s === 'on_leave') onLeave++;
      else if (s === 'no_report') noReport++;
    }
    return { reported, paused, onLeave, noReport };
  });

  // Ciclo abierto actual y quiénes no reportaron
  const openCycle = cycles.find(c => c.status === 'open');
  const sinReporte = openCycle
    ? activeUsers.filter(u => resolveCellStatus(u.id, openCycle) === 'no_report')
    : [];

  return (
    <div className="max-w-full space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Cumplimiento</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Participación semanal — últimas {cycles.length} semanas.
          </p>
        </div>
        <DownloadXlsxButton />
      </div>

      {/* Alerta: sin reporte en ciclo abierto */}
      {sinReporte.length > 0 && openCycle && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 mb-1">
            Sin reporte en S{openCycle.iso_week} — {sinReporte.length} secretario{sinReporte.length !== 1 ? 's' : ''}:
          </p>
          <p className="text-sm text-red-700 leading-relaxed">
            {sinReporte.map(u => u.full_name.split(/\s+/)[0]).join(' · ')}
          </p>
        </div>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-600">
        {([
          ['reported',  'bg-green-600',  'Reportó'],
          ['paused',    'bg-yellow-500', 'Esta semana paso'],
          ['on_leave',  'bg-zinc-400',   'Licencia'],
          ['no_report', 'bg-red-600',    'Sin reporte'],
        ] as [string, string, string][]).map(([, bg, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm ${bg}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="text-left px-4 py-3 font-medium text-zinc-700 min-w-[180px] sticky left-0 bg-zinc-50 z-10">
                Secretario/a
              </th>
              {cycles.map((c, i) => {
                const isOpen = c.status === 'open';
                const isPending = c.status === 'pending';
                const stats = cycleStats[i]!;
                return (
                  <th key={c.id} className="px-3 py-2 text-center min-w-[100px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className={`font-bold text-sm ${isOpen ? 'text-blue-700' : 'text-zinc-700'}`}>
                          S{c.iso_week}
                        </span>
                        {isOpen && (
                          <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-blue-100 text-blue-700">
                            actual
                          </span>
                        )}
                        {isPending && (
                          <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-zinc-200 text-zinc-500">
                            próxima
                          </span>
                        )}
                      </div>
                      {!isPending && (
                        <div className="text-[10px] font-normal text-zinc-400">
                          {stats.reported}/{activeUsers.length} reportaron
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeUsers.map((u, uIdx) => {
              const rowBg = uIdx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50';
              return (
                <tr key={u.id} className={`border-b border-zinc-100 last:border-0 ${rowBg}`}>
                  <td className={`px-4 py-2 text-zinc-800 text-sm font-medium sticky left-0 z-10 ${rowBg}`}>
                    {u.full_name}
                  </td>
                  {cycles.map(c => {
                    const status = resolveCellStatus(u.id, c);
                    const cfg = CELL_CONFIG[status];
                    return (
                      <td key={c.id} className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-14 h-7 rounded text-xs font-semibold ${cfg.bg} ${cfg.text}`}
                          title={cfg.tooltip}
                        >
                          {cfg.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Fila de totales */}
            <tr className="border-t-2 border-zinc-200 bg-zinc-100 font-semibold">
              <td className="px-4 py-2.5 text-zinc-700 text-sm sticky left-0 bg-zinc-100 z-10">
                Totales
              </td>
              {cycleStats.map((stats, i) => (
                <td key={i} className="px-3 py-2.5 text-center align-top">
                  {cycles[i]!.status === 'pending' ? (
                    <span className="text-xs text-zinc-400">—</span>
                  ) : (
                    <div className="text-xs space-y-0.5">
                      <div className="text-green-700 font-bold">{stats.reported} ✓</div>
                      {stats.paused > 0 && <div className="text-yellow-600">{stats.paused} paso</div>}
                      {stats.onLeave > 0 && <div className="text-zinc-500">{stats.onLeave} lic.</div>}
                      <div className="text-red-600 font-semibold">{stats.noReport} ✗</div>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
