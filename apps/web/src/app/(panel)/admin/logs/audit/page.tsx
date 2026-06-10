// Página del log de auditoría.
// Solo accesible para el rol press_admin.
// Muestra las últimas 100 acciones registradas en el sistema:
// quién hizo qué y cuándo (aprobaciones, ediciones, descards, etc.).
// Sirve para transparencia interna y para investigar si algo salió mal.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { desc, inArray } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { Card, CardContent } from '@/components/ui/card';

export default async function AdminLogsAuditPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const entries = await db.query.auditLog.findMany({
    orderBy: [desc(schema.auditLog.created_at)],
    limit: 100,
    columns: {
      id: true,
      actor_user_id: true,
      action: true,
      entity_type: true,
      entity_id: true,
      meta: true,
      created_at: true,
    },
  });

  const actorIds = Array.from(new Set(entries.map(e => e.actor_user_id)));
  const actors =
    actorIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, actorIds),
          columns: { id: true, full_name: true },
        })
      : [];
  const actorMap = new Map(actors.map(a => [a.id, a.full_name]));

  const rows = entries.map(e => ({
    id: e.id,
    actor_name: actorMap.get(e.actor_user_id) ?? 'Desconocido',
    action: e.action,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    meta: e.meta as Record<string, unknown> | null,
    created_at: e.created_at.toISOString(),
  }));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Log de auditoría</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Últimas 100 acciones registradas en el sistema.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-zinc-400 text-sm">
            No hay entradas de auditoría registradas aún.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-medium text-zinc-600">Fecha</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Usuario</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Acción</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Entidad</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}>
                    <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-zinc-800">{row.actor_name}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-block px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-xs font-mono">
                        {row.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">
                      <span className="text-xs text-zinc-400 mr-1">{row.entity_type}</span>
                      <span className="font-mono text-xs text-zinc-500">{row.entity_id.slice(0, 8)}…</span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 text-xs max-w-xs truncate">
                      {row.meta ? JSON.stringify(row.meta).slice(0, 80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
