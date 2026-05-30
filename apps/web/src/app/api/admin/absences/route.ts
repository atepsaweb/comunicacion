import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// GET /api/admin/absences — lista TODAS las ausencias con info del usuario
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const absences = await db.query.absences.findMany({
    orderBy: [desc(schema.absences.starts_on)],
    limit: 200,
  });

  const userIds = Array.from(new Set(absences.map(a => a.user_id)));
  const users =
    userIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, full_name: true, position: true },
        })
      : [];

  const userMap = new Map(users.map(u => [u.id, u]));

  const result = absences.map(a => ({
    id: a.id,
    user_id: a.user_id,
    user_name: userMap.get(a.user_id)?.full_name ?? 'Desconocido',
    user_position: userMap.get(a.user_id)?.position ?? null,
    type: a.type,
    starts_on: a.starts_on,
    ends_on: a.ends_on,
    reason: a.reason,
    source: a.source,
    created_at: a.created_at,
  }));

  return NextResponse.json({ absences: result });
}

// POST /api/admin/absences — crea ausencia para cualquier usuario
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    user_id: string;
    type: string;
    starts_on: string;
    ends_on: string;
    reason?: string;
  };

  const { user_id, type, starts_on, ends_on, reason } = body;

  if (!user_id || !type || !starts_on || !ends_on) {
    return NextResponse.json({ error: 'user_id, type, starts_on y ends_on son requeridos' }, { status: 400 });
  }

  if (!['scheduled_leave', 'weekly_pause'].includes(type)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
  }

  if (starts_on > ends_on) {
    return NextResponse.json({ error: 'La fecha de inicio no puede ser posterior al fin' }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, user_id),
    columns: { id: true },
  });

  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const [absence] = await db
    .insert(schema.absences)
    .values({
      user_id,
      type: type as 'scheduled_leave' | 'weekly_pause',
      starts_on,
      ends_on,
      reason: reason ?? null,
      source: 'admin',
      registered_by: session.user.id,
    })
    .returning({ id: schema.absences.id });

  return NextResponse.json({ absence }, { status: 201 });
}
