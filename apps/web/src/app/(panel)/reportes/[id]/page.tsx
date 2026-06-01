import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { Card, CardContent } from '@/components/ui/card';

const priorityLabel: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta' };
const priorityColor: Record<string, string> = {
  low: 'text-zinc-400',
  medium: 'text-yellow-600',
  high: 'text-red-600',
};
const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  awaiting_followup: 'En seguimiento',
  complete: 'Completo',
  paused: 'En pausa',
  on_leave: 'Con licencia',
  no_report: 'Sin reporte',
};

interface Props {
  params: { id: string };
}

export default async function ReporteDetailPage({ params }: Props) {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, params.id),
    columns: {
      id: true,
      user_id: true,
      cycle_id: true,
      status: true,
      completeness_score: true,
      followup_count: true,
      first_message_at: true,
      last_message_at: true,
    },
  });

  if (!report) notFound();

  // Solo el propio secretario o press_admin puede ver el reporte
  if (report.user_id !== session.user.id && session.user.role !== 'press_admin') {
    notFound();
  }

  const [items, cycle] = await Promise.all([
    db.query.reportItems.findMany({
      where: eq(schema.reportItems.report_id, report.id),
      columns: {
        id: true,
        category: true,
        title: true,
        description_md: true,
        mentions: true,
        priority: true,
        is_public_safe: true,
        order_index: true,
      },
    }),
    db.query.weeklyCycles.findFirst({
      where: eq(schema.weeklyCycles.id, report.cycle_id!),
      columns: { iso_week: true, year: true, starts_at: true, ends_at: true },
    }),
  ]);

  // Agrupar items por categoría
  const byCategory = items.reduce<Record<string, typeof items>>(
    (acc, item) => {
      const cat = item.category ?? 'Otro';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {},
  );

  const score = report.completeness_score != null ? Number(report.completeness_score) : null;
  const scorePercent = score != null ? Math.round(score * 100) : null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Encabezado */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">
            Reporte semana {cycle?.iso_week}/{cycle?.year}
          </h1>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
            {statusLabel[report.status] ?? report.status}
          </span>
        </div>
        {cycle && (
          <p className="text-zinc-500 mt-1 text-sm">
            {new Date(cycle.starts_at).toLocaleDateString('es-AR', {
              day: '2-digit',
              month: 'long',
            })}{' '}
            al{' '}
            {new Date(cycle.ends_at).toLocaleDateString('es-AR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Banner awaiting_followup */}
      {report.status === 'awaiting_followup' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          El sistema te envió una pregunta de seguimiento por WhatsApp. Cuando respondas, tu reporte se actualizará automáticamente.
          {report.followup_count > 0 && (
            <span className="ml-2 text-xs text-amber-600">
              (pregunta {report.followup_count} de 2)
            </span>
          )}
        </div>
      )}

      {/* Métricas */}
      {score != null && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div>
            <p className="text-zinc-400 text-xs">Completitud</p>
            <p
              className={`font-semibold ${
                score >= 0.7 ? 'text-green-600' : score >= 0.4 ? 'text-yellow-600' : 'text-red-500'
              }`}
            >
              {scorePercent}%
            </p>
          </div>
          <div>
            <p className="text-zinc-400 text-xs">Ítems</p>
            <p className="font-semibold text-zinc-800">{items.length}</p>
          </div>
          {report.followup_count > 0 && (
            <div>
              <p className="text-zinc-400 text-xs">Repregunta</p>
              <p className="font-semibold text-zinc-800">
                {report.followup_count === 1 ? 'enviada' : `${report.followup_count} enviadas`}
              </p>
            </div>
          )}
          {report.last_message_at && (
            <div>
              <p className="text-zinc-400 text-xs">Último mensaje</p>
              <p className="font-semibold text-zinc-800">
                {new Date(report.last_message_at).toLocaleString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Contenido */}
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-zinc-400 text-sm">
              No hay ítems extraídos todavía. El sistema procesa los mensajes en unos instantes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(byCategory).map(([category, categoryItems]) => (
            <div key={category} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {category}
              </h2>
              {categoryItems
                .sort((a, b) => a.order_index - b.order_index)
                .map((item) => {
                  const mentions = Array.isArray(item.mentions)
                    ? (item.mentions as string[])
                    : [];
                  return (
                    <Card key={item.id}>
                      <CardContent className="py-4 px-5 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-medium text-zinc-900 text-sm leading-snug">
                            {item.title}
                          </h3>
                          <div className="flex items-center gap-2 shrink-0">
                            {!item.is_public_safe && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                                Interno
                              </span>
                            )}
                            {item.priority && (
                              <span
                                className={`text-xs font-medium ${priorityColor[item.priority] ?? ''}`}
                              >
                                {priorityLabel[item.priority] ?? item.priority}
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-sm text-zinc-700 leading-relaxed">
                          {item.description_md}
                        </p>

                        {mentions.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {mentions.map((m) => (
                              <span
                                key={m}
                                className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
