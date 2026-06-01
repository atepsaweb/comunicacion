import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const roleLabels: Record<string, string> = {
  secretary: 'Secretario/a',
  executive: 'Mesa Ejecutiva',
  press_admin: 'Prensa',
};

function cycleStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case 'open':      return { label: 'Abierto',    color: 'text-green-600'  };
    case 'closed':    return { label: 'Cerrado',    color: 'text-yellow-600' };
    case 'processed': return { label: 'Procesado',  color: 'text-blue-600'   };
    case 'published': return { label: 'Publicado',  color: 'text-zinc-500'   };
    default:          return { label: status,       color: 'text-zinc-400'   };
  }
}

function formatCloseDate(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function reportStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case 'complete':          return { label: 'Completo',        color: 'text-green-700'  };
    case 'awaiting_followup': return { label: 'En seguimiento',  color: 'text-yellow-700' };
    case 'draft':             return { label: 'Borrador',        color: 'text-zinc-600'   };
    case 'paused':            return { label: 'Pausado',         color: 'text-zinc-500'   };
    case 'on_leave':          return { label: 'Con licencia',    color: 'text-zinc-400'   };
    default:                  return { label: status,            color: 'text-zinc-400'   };
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = session.user.role;

  // Ciclo más reciente que no sea 'pending'
  const cycle = await db.query.weeklyCycles.findFirst({
    where: inArray(schema.weeklyCycles.status, ['open', 'closed', 'processed', 'published']),
    orderBy: [desc(schema.weeklyCycles.starts_at)],
  });

  // Usuarios activos (secretary + executive — excluye press_admin del conteo de participación)
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true },
  });
  const totalActive = activeUsers.length;

  // Reportes del ciclo actual
  const cycleReports = cycle
    ? await db.query.reports.findMany({
        where: eq(schema.reports.cycle_id, cycle.id),
        columns: { id: true, user_id: true, status: true, completeness_score: true },
      })
    : [];

  const reportedCount = cycleReports.filter(r =>
    r.status !== 'no_report' && r.status !== 'on_leave',
  ).length;

  // Mi reporte (secretarios)
  const myReport = cycle
    ? cycleReports.find(r => r.user_id === session.user.id)
    : undefined;

  // Publicaciones pendientes de revisión (press_admin)
  const pendingPublications = (role === 'press_admin' && cycle)
    ? await db.query.publications.findMany({
        where: and(
          eq(schema.publications.cycle_id, cycle.id),
          or(
            eq(schema.publications.status, 'draft'),
            eq(schema.publications.status, 'in_review'),
          ),
        ),
        columns: { id: true },
      })
    : [];

  const cycleStatus = cycle ? cycleStatusLabel(cycle.status) : null;
  const participationPct = totalActive > 0
    ? Math.round((reportedCount / totalActive) * 100)
    : 0;

  const quickLinks = {
    press_admin: [
      { href: '/revision',                  label: 'Revisión'       },
      { href: '/ejecutivo/cumplimiento',    label: 'Cumplimiento'   },
      { href: '/ejecutivo/estadisticas',    label: 'Estadísticas'   },
      { href: '/admin/glosario',            label: 'Glosario IA'    },
    ],
    executive: [
      { href: '/ejecutivo/cumplimiento',    label: 'Cumplimiento'   },
      { href: '/ejecutivo/estadisticas',    label: 'Estadísticas'   },
    ],
    secretary: [
      { href: '/mis-mensajes',              label: 'Mis mensajes'   },
      { href: '/ausencias',                 label: 'Mis ausencias'  },
    ],
  } as const;

  const links = quickLinks[role as keyof typeof quickLinks] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900 break-words">
          Bienvenido/a, {session.user.full_name}
        </h1>
        <p className="text-sm md:text-base text-zinc-500 mt-1">
          {roleLabels[role] ?? role} — Secretariado Nacional
        </p>
      </div>

      {/* Tarjetas principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Ciclo actual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo actual</CardTitle>
          </CardHeader>
          <CardContent>
            {cycle ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold text-zinc-900">
                  Semana {cycle.iso_week} · {cycle.year}
                </p>
                <p className={`text-sm font-medium ${cycleStatus!.color}`}>
                  {cycleStatus!.label}
                </p>
                {cycle.status === 'open' && (
                  <p className="text-xs text-zinc-400">
                    Cierra {formatCloseDate(cycle.closes_at)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 italic">Sin ciclo activo</p>
            )}
          </CardContent>
        </Card>

        {/* Reportes / Mi reporte */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {role === 'secretary' ? 'Mi reporte esta semana' : 'Participación'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!cycle ? (
              <p className="text-sm text-zinc-400 italic">Sin ciclo activo</p>
            ) : role === 'secretary' ? (
              myReport ? (
                <div className="space-y-1">
                  <p className={`text-xl font-bold ${reportStatusLabel(myReport.status).color}`}>
                    {reportStatusLabel(myReport.status).label}
                  </p>
                  {myReport.completeness_score !== null && (
                    <p className="text-xs text-zinc-400">
                      Completitud: {Math.round(Number(myReport.completeness_score) * 100)}%
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-400 italic">
                  {cycle.status === 'open'
                    ? 'Todavía no enviaste reporte esta semana.'
                    : 'No reportaste en este ciclo.'}
                </p>
              )
            ) : (
              <div className="space-y-2">
                <p className="text-3xl font-bold text-zinc-900">{reportedCount}</p>
                <p className="text-sm text-zinc-500">
                  de {totalActive} secretarios reportaron
                </p>
                <div className="w-full bg-zinc-100 rounded-full h-1.5">
                  <div
                    className="bg-zinc-800 h-1.5 rounded-full transition-all"
                    style={{ width: `${participationPct}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-400">{participationPct}% de participación</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Publicaciones pendientes (press_admin) o participación (otros) */}
        {role === 'press_admin' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publicaciones a revisar</CardTitle>
            </CardHeader>
            <CardContent>
              {pendingPublications.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-3xl font-bold text-zinc-900">
                    {pendingPublications.length}
                  </p>
                  <p className="text-sm text-zinc-500">pendientes de revisión</p>
                  <Link
                    href="/revision"
                    className="inline-block text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
                  >
                    Ir a Revisión →
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-zinc-900">0</p>
                  <p className="text-sm text-zinc-400">Nada pendiente</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Secretariado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-zinc-900">{totalActive}</p>
                <p className="text-sm text-zinc-500">secretarios activos</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Accesos rápidos */}
      {links.length > 0 && (
        <div className={`grid gap-3 ${links.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-center px-4 py-3 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
