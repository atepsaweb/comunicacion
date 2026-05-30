import { NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// GET /api/admin/logs/ai?purpose=&cycleId=&limit=
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const purposeFilter = searchParams.get('purpose');
  const cycleIdFilter = searchParams.get('cycleId');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200'), 500);

  const rows = await db.query.aiInvocations.findMany({
    where: purposeFilter
      ? eq(schema.aiInvocations.purpose, purposeFilter as typeof schema.aiInvocations.purpose._.data)
      : undefined,
    orderBy: [desc(schema.aiInvocations.created_at)],
    limit,
    columns: {
      id: true,
      purpose: true,
      model: true,
      related_cycle_id: true,
      input_tokens: true,
      output_tokens: true,
      cache_read_tokens: true,
      cost_usd: true,
      latency_ms: true,
      success: true,
      triggered_by: true,
      created_at: true,
    },
  });

  const filtered = cycleIdFilter
    ? rows.filter(r => r.related_cycle_id === cycleIdFilter)
    : rows;

  // Enriquecer con iso_week/year del ciclo para los que tienen related_cycle_id
  const cycleIds = Array.from(new Set(
    filtered.map(r => r.related_cycle_id).filter((id): id is string => id !== null),
  ));

  const cycles =
    cycleIds.length > 0
      ? await db.query.weeklyCycles.findMany({
          where: (wc, { inArray }) => inArray(wc.id, cycleIds),
          columns: { id: true, iso_week: true, year: true },
        })
      : [];

  const cycleMap = new Map(cycles.map(c => [c.id, c]));

  const result = filtered.map(r => ({
    ...r,
    cost_usd: r.cost_usd,
    cycle_label: r.related_cycle_id
      ? (() => {
          const c = cycleMap.get(r.related_cycle_id);
          return c ? `S${c.iso_week}/${c.year}` : null;
        })()
      : null,
  }));

  return NextResponse.json({ logs: result });
}
