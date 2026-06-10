// API para consultar el log de auditoría del sistema.
// Devuelve las últimas 100 acciones, enriquecidas con el nombre del usuario que las realizó.
// Lo consume el panel de auditoría (/admin/logs/audit).
// Solo accesible para press_admin.
import { NextResponse } from 'next/server';
import { desc, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// GET /api/admin/logs/audit — últimas 100 entradas del audit_log
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  const result = entries.map(e => ({
    ...e,
    actor_name: actorMap.get(e.actor_user_id) ?? 'Desconocido',
  }));

  return NextResponse.json({ entries: result });
}
