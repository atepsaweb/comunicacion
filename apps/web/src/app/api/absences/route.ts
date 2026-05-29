import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const absences = await db.query.absences.findMany({
    where: eq(schema.absences.user_id, session.user.id),
    orderBy: [desc(schema.absences.starts_on)],
    limit: 30,
  });

  return NextResponse.json({ absences });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, starts_on, ends_on, reason } = body as {
    type: string;
    starts_on: string;
    ends_on: string;
    reason?: string;
  };

  if (!type || !starts_on || !ends_on) {
    return NextResponse.json({ error: 'type, starts_on y ends_on son requeridos' }, { status: 400 });
  }

  if (!['scheduled_leave', 'weekly_pause'].includes(type)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
  }

  if (starts_on > ends_on) {
    return NextResponse.json({ error: 'La fecha de inicio no puede ser posterior al fin' }, { status: 400 });
  }

  const [absence] = await db
    .insert(schema.absences)
    .values({
      user_id: session.user.id,
      type: type as 'scheduled_leave' | 'weekly_pause',
      starts_on,
      ends_on,
      reason: reason ?? null,
      source: 'panel',
      registered_by: session.user.id,
    })
    .returning({
      id: schema.absences.id,
      type: schema.absences.type,
      starts_on: schema.absences.starts_on,
      ends_on: schema.absences.ends_on,
      reason: schema.absences.reason,
      created_at: schema.absences.created_at,
    });

  return NextResponse.json({ absence }, { status: 201 });
}
