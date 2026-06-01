import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, params.id),
    columns: { id: true, status: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Ciclo no encontrado' }, { status: 404 });

  if (cycle.status === 'open' || cycle.status === 'pending') {
    return NextResponse.json({ error: 'El ciclo todavía no fue procesado' }, { status: 400 });
  }

  await db
    .update(schema.weeklyCycles)
    .set({ status: 'published', published_at: new Date(), updated_at: new Date() })
    .where(eq(schema.weeklyCycles.id, params.id));

  logger.info({ cycleId: params.id, userId: session.user.id }, 'cycle marked as published');

  return NextResponse.json({ ok: true, status: 'published' });
}
