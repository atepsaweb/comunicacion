import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // El ciclo más reciente que esté abierto o cerrado (no procesado ni publicado)
  const cycles = await db.query.weeklyCycles.findMany({
    columns: { id: true, iso_week: true, year: true, status: true, starts_at: true, ends_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 5,
  });

  const current = cycles.find(c => c.status === 'open' || c.status === 'closed') ?? cycles[0];

  if (!current) {
    return NextResponse.json({ error: 'No active cycle found' }, { status: 404 });
  }

  return NextResponse.json({
    cycleId: current.id,
    isoWeek: current.iso_week,
    year: current.year,
    status: current.status,
    startsAt: current.starts_at,
    endsAt: current.ends_at,
  });
}
