import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { ProposalsClient } from './proposals-client';

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatART(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.toLocaleDateString('es-AR', {
      timeZone: ART_TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  return date.toLocaleString('es-AR', {
    timeZone: ART_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default async function PropuestasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const { role } = session.user;
  if (role !== 'press_admin' && role !== 'executive') redirect('/agenda');

  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      starts_at: schema.events.starts_at,
      all_day: schema.events.all_day,
      location: schema.events.location,
      description_md: schema.events.description_md,
      created_at: schema.events.created_at,
      creator_name: schema.users.full_name,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.created_by, schema.users.id))
    .where(and(eq(schema.events.status, 'proposed')))
    .orderBy(schema.events.starts_at);

  const proposals = rows.map(r => ({
    ...r,
    starts_at: r.starts_at.toISOString(),
    starts_at_label: formatART(r.starts_at, r.all_day),
    created_at: r.created_at.toISOString(),
    creator_name: r.creator_name ?? '—',
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/agenda" className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
            ← Agenda
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900 mt-1">Propuestas pendientes</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Eventos propuestos por secretarios que esperan aprobación.
          </p>
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">No hay propuestas pendientes de aprobación.</p>
        </div>
      ) : (
        <ProposalsClient proposals={proposals} canApprove={role === 'press_admin' || role === 'executive'} />
      )}
    </div>
  );
}
