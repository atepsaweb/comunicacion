import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { IALogsClient } from './ia-logs-client';

export default async function AdminLogsIAPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const rows = await db.query.aiInvocations.findMany({
    orderBy: [desc(schema.aiInvocations.created_at)],
    limit: 200,
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

  const cycleIds = Array.from(new Set(
    rows.map(r => r.related_cycle_id).filter((id): id is string => id !== null),
  ));

  const cycles =
    cycleIds.length > 0
      ? await db.query.weeklyCycles.findMany({
          where: (wc, { inArray }) => inArray(wc.id, cycleIds),
          columns: { id: true, iso_week: true, year: true },
        })
      : [];

  const cycleMap = new Map(cycles.map(c => [c.id, c]));

  const logs = rows.map(r => ({
    id: r.id,
    purpose: r.purpose,
    model: r.model,
    related_cycle_id: r.related_cycle_id,
    cycle_label: r.related_cycle_id
      ? (() => {
          const c = cycleMap.get(r.related_cycle_id);
          return c ? `S${c.iso_week}/${c.year}` : null;
        })()
      : null,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cost_usd: r.cost_usd,
    latency_ms: r.latency_ms,
    success: r.success,
    triggered_by: r.triggered_by,
    created_at: r.created_at.toISOString(),
  }));

  return <IALogsClient logs={logs} />;
}
