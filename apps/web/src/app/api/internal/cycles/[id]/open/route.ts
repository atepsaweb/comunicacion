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

  if (cycle.status === 'open') {
    return NextResponse.json({ ok: true, status: 'open', note: 'already_open' });
  }

  if (cycle.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot open cycle in status '${cycle.status}'` },
      { status: 409 },
    );
  }

  await db
    .update(schema.weeklyCycles)
    .set({ status: 'open', updated_at: new Date() })
    .where(eq(schema.weeklyCycles.id, params.id));

  return NextResponse.json({ ok: true, status: 'open' });
}
