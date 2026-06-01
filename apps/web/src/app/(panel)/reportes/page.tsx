import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import * as schema from '@/db/schema';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

// ─── Vista personal (secretario / ejecutivo) ─────────────────────────────────

const reportStatusLabel: Record<string, string> = {
  draft: 'Borrador',
  awaiting_followup: 'En seguimiento',
  complete: 'Completo',
  paused: 'En pausa',
  on_leave: 'Con licencia',
  no_report: 'Sin reporte',
};

const reportStatusColor: Record<string, string> = {
  draft: 'text-yellow-600 bg-yellow-50',
  awaiting_followup: 'text-blue-600 bg-blue-50',
  complete: 'text-green-600 bg-green-50',
  paused: 'text-zinc-500 bg-zinc-100',
  on_leave: 'text-zinc-500 bg-zinc-100',
  no_report: 'text-red-500 bg-red-50',
};

// ─── Vista admin (press_admin) ────────────────────────────────────────────────

// Devuelve label y color teniendo en cuenta el estado del consolidado
function getCycleDisplay(
  cycleStatus: string,
  consolidationStatus: string | undefined,
): { label: string; color: string } {
  if (cycleStatus === 'published') {
    return { label: 'Enviado', color: 'text-green-700 bg-green-50' };
  }
  if (cycleStatus === 'processed') {
    if (consolidationStatus === 'approved' || consolidationStatus === 'sent') {
      return { label: 'Aprobado', color: 'text-indigo-700 bg-indigo-50' };
    }
    return { label: 'Procesado', color: 'text-blue-700 bg-blue-50' };
  }
  const labels: Record<string, string> = { open: 'Abierto', closed: 'Cerrado' };
  const colors: Record<string, string> = {
    open: 'text-green-700 bg-green-50',
    closed: 'text-yellow-700 bg-yellow-50',
  };
  return { label: labels[cycleStatus] ?? cycleStatus, color: colors[cycleStatus] ?? 'text-zinc-600 bg-zinc-100' };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReportesPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  // ── press_admin: archivo histórico de ciclos ──────────────────────────────
  if (session.user.role === 'press_admin') {
    const cycles = await db.query.weeklyCycles.findMany({
      where: inArray(schema.weeklyCycles.status, ['open', 'closed', 'processed', 'published']),
      columns: {
        id: true,
        iso_week: true,
        year: true,
        status: true,
        starts_at: true,
        ends_at: true,
        processed_at: true,
      },
      orderBy: [desc(schema.weeklyCycles.starts_at)],
      limit: 52, // ~1 año
    });

    const cycleIds = cycles.map(c => c.id);

    // Estado de consolidados por ciclo
    const consolidations =
      cycleIds.length > 0
        ? await db.query.consolidations.findMany({
            where: inArray(schema.consolidations.cycle_id, cycleIds),
            columns: { cycle_id: true, status: true },
          })
        : [];
    const consolidationByCycle = new Map(consolidations.map(con => [con.cycle_id, con.status]));

    // Conteo de reportes por ciclo
    const reports =
      cycleIds.length > 0
        ? await db.query.reports.findMany({
            where: and(
              inArray(schema.reports.cycle_id, cycleIds),
              ne(schema.reports.status, 'no_report'),
            ),
            columns: { cycle_id: true },
          })
        : [];

    const reportsByCycle = new Map<string, number>();
    for (const r of reports) {
      reportsByCycle.set(r.cycle_id, (reportsByCycle.get(r.cycle_id) ?? 0) + 1);
    }

    // Total activos
    const activeUsers = await db.query.users.findMany({
      where: and(
        eq(schema.users.is_active, true),
        inArray(schema.users.role, ['secretary', 'executive']),
      ),
      columns: { id: true },
    });
    const totalActive = activeUsers.length;

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Archivo de semanas</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Historial de ciclos semanales. Hacé clic en una semana para ver su revisión.
          </p>
        </div>

        {cycles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-zinc-400 text-sm">No hay ciclos registrados todavía.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {cycles.map(c => {
              const count = reportsByCycle.get(c.id) ?? 0;
              const pct = totalActive > 0 ? Math.round((count / totalActive) * 100) : 0;
              const display = getCycleDisplay(c.status, consolidationByCycle.get(c.id));
              return (
                <li key={c.id}>
                  <Link href={`/revision?cycleId=${c.id}`}>
                    <Card className="hover:border-zinc-400 transition-colors cursor-pointer">
                      <CardContent className="py-3 px-5 flex items-center gap-4">

                        {/* Semana + rango */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-zinc-800 text-sm">
                            Semana {c.iso_week}/{c.year}
                          </p>
                          <p className="text-xs text-zinc-400">
                            {new Date(c.starts_at).toLocaleDateString('es-AR', {
                              day: '2-digit', month: '2-digit',
                              timeZone: 'America/Argentina/Buenos_Aires',
                            })}
                            {' – '}
                            {new Date(c.ends_at).toLocaleDateString('es-AR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              timeZone: 'America/Argentina/Buenos_Aires',
                            })}
                          </p>
                        </div>

                        {/* Participación */}
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium text-zinc-700">{count}/{totalActive}</p>
                          <p className="text-xs text-zinc-400">{pct}% reportaron</p>
                        </div>

                        {/* Estado */}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${display.color}`}>
                          {display.label}
                        </span>

                        <span className="text-zinc-300 text-xs shrink-0">→</span>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── secretary / executive: reportes personales ────────────────────────────
  const rows = await db
    .select({
      id: schema.reports.id,
      status: schema.reports.status,
      completeness_score: schema.reports.completeness_score,
      first_message_at: schema.reports.first_message_at,
      last_message_at: schema.reports.last_message_at,
      cycle_starts_at: schema.weeklyCycles.starts_at,
      cycle_ends_at: schema.weeklyCycles.ends_at,
      cycle_iso_week: schema.weeklyCycles.iso_week,
      cycle_year: schema.weeklyCycles.year,
    })
    .from(schema.reports)
    .innerJoin(schema.weeklyCycles, eq(schema.weeklyCycles.id, schema.reports.cycle_id))
    .where(eq(schema.reports.user_id, session.user.id))
    .orderBy(desc(schema.weeklyCycles.starts_at))
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Mis reportes</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Reportes semanales generados a partir de tus mensajes.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-zinc-400 text-sm">
              Todavía no tenés reportes generados. Mandá un mensaje de audio o texto al bot y el sistema lo va a procesar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const score = r.completeness_score != null ? Number(r.completeness_score) : null;
            const scoreText =
              score != null
                ? score >= 0.7 ? 'Completo' : score >= 0.4 ? 'Parcial' : 'Escueto'
                : null;
            const scoreColor =
              score != null
                ? score >= 0.7 ? 'text-green-600' : score >= 0.4 ? 'text-yellow-600' : 'text-red-500'
                : '';

            return (
              <li key={r.id}>
                <Link href={`/reportes/${r.id}`}>
                  <Card className="hover:border-zinc-400 transition-colors cursor-pointer">
                    <CardContent className="py-4 px-5 flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <p className="font-medium text-zinc-800 text-sm">
                          Semana {r.cycle_iso_week}/{r.cycle_year} —{' '}
                          {new Date(r.cycle_starts_at).toLocaleDateString('es-AR', {
                            day: '2-digit', month: '2-digit',
                          })}{' '}
                          al{' '}
                          {new Date(r.cycle_ends_at).toLocaleDateString('es-AR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                          })}
                        </p>
                        {r.last_message_at && (
                          <p className="text-xs text-zinc-400">
                            Último mensaje:{' '}
                            {new Date(r.last_message_at).toLocaleString('es-AR', {
                              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {score != null && (
                          <span className={`text-xs font-medium ${scoreColor}`}>{scoreText}</span>
                        )}
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${reportStatusColor[r.status] ?? 'text-zinc-500 bg-zinc-100'}`}
                        >
                          {reportStatusLabel[r.status] ?? r.status}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
