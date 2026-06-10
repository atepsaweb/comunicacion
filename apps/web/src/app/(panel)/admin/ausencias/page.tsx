// Página de administración de ausencias (vista del admin).
// Solo accesible para el rol press_admin.
// A diferencia de /ausencias (donde cada secretario ve solo sus propias ausencias),
// acá Julián puede ver y gestionar las ausencias de todos los integrantes del Secretariado.
// Permite registrar ausencias en nombre de cualquier secretario y borrar las incorrectas.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { AdminAusenciasClient } from './admin-ausencias-client';

export default async function AdminAusenciasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  // Todos los usuarios activos ordenados por nombre
  const users = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true, full_name: true, position: true },
    orderBy: [schema.users.full_name],
  });

  // Todas las ausencias con info de usuario
  const absences = await db.query.absences.findMany({
    orderBy: [desc(schema.absences.starts_on)],
    limit: 200,
  });

  const userIds = Array.from(new Set(absences.map(a => a.user_id)));
  const absenceUsers =
    userIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, full_name: true, position: true },
        })
      : [];

  const userMap = new Map(absenceUsers.map(u => [u.id, u]));

  const absencesWithUser = absences.map(a => ({
    id: a.id,
    user_id: a.user_id,
    user_name: userMap.get(a.user_id)?.full_name ?? 'Desconocido',
    user_position: userMap.get(a.user_id)?.position ?? null,
    type: a.type,
    starts_on: a.starts_on,
    ends_on: a.ends_on,
    reason: a.reason,
    source: a.source,
    created_at: a.created_at.toISOString(),
  }));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Ausencias (Admin)</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Registrá y gestioná ausencias de cualquier integrante del Secretariado.
        </p>
      </div>
      <AdminAusenciasClient
        initialAbsences={absencesWithUser}
        users={users}
      />
    </div>
  );
}
