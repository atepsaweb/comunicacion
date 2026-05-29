import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, params.id),
    columns: { id: true, status: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  if (cycle.status === 'closed' || cycle.status === 'processed' || cycle.status === 'published') {
    return NextResponse.json({ ok: true, status: cycle.status, note: 'already_closed' });
  }

  await db
    .update(schema.weeklyCycles)
    .set({ status: 'closed', updated_at: new Date() })
    .where(eq(schema.weeklyCycles.id, params.id));

  return NextResponse.json({ ok: true, status: 'closed' });
}
