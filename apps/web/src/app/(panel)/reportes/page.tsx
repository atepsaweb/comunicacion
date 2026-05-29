import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  awaiting_followup: 'En seguimiento',
  complete: 'Completo',
  paused: 'En pausa',
  on_leave: 'Con licencia',
  no_report: 'Sin reporte',
};

const statusColor: Record<string, string> = {
  draft: 'text-yellow-600 bg-yellow-50',
  awaiting_followup: 'text-blue-600 bg-blue-50',
  complete: 'text-green-600 bg-green-50',
  paused: 'text-zinc-500 bg-zinc-100',
  on_leave: 'text-zinc-500 bg-zinc-100',
  no_report: 'text-red-500 bg-red-50',
};

export default async function ReportesPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

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
                ? score >= 0.7
                  ? 'Completo'
                  : score >= 0.4
                    ? 'Parcial'
                    : 'Escueto'
                : null;
            const scoreColor =
              score != null
                ? score >= 0.7
                  ? 'text-green-600'
                  : score >= 0.4
                    ? 'text-yellow-600'
                    : 'text-red-500'
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
                            day: '2-digit',
                            month: '2-digit',
                          })}{' '}
                          al{' '}
                          {new Date(r.cycle_ends_at).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </p>
                        {r.last_message_at && (
                          <p className="text-xs text-zinc-400">
                            Último mensaje:{' '}
                            {new Date(r.last_message_at).toLocaleString('es-AR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {score != null && (
                          <span className={`text-xs font-medium ${scoreColor}`}>{scoreText}</span>
                        )}
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[r.status] ?? 'text-zinc-500 bg-zinc-100'}`}
                        >
                          {statusLabel[r.status] ?? r.status}
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
