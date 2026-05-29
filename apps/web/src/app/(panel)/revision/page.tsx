import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { RevisionClient } from './revision-client';

export default async function RevisionPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  // Ciclo más reciente que tenga alguna actividad
  const cycles = await db.query.weeklyCycles.findMany({
    columns: { id: true, iso_week: true, year: true, status: true, starts_at: true, ends_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 5,
  });

  // Tomar el más reciente que no sea 'pending'
  const cycle = cycles.find(c => c.status !== 'pending') ?? cycles[0];

  if (!cycle) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-zinc-900">Revisión</h1>
        <p className="text-zinc-500 text-sm">No hay ciclos activos. El sistema crea uno automáticamente al inicio de cada semana.</p>
      </div>
    );
  }

  // Consolidación del ciclo
  const consolidation = await db.query.consolidations.findFirst({
    where: (c, { eq }) => eq(c.cycle_id, cycle.id),
    columns: { id: true, internal_summary_md: true, status: true, generated_at: true },
  });

  // Publicaciones del ciclo con versión actual
  const publications = await db.query.publications.findMany({
    where: (p, { eq }) => eq(p.cycle_id, cycle.id),
    columns: { id: true, kind: true, status: true, current_version_id: true, updated_at: true },
    orderBy: [schema.publications.kind],
  });

  // Versiones actuales de cada publicación
  const versionIds = publications.map(p => p.current_version_id).filter(Boolean) as string[];

  let versionMap = new Map<string, string>();
  if (versionIds.length > 0) {
    const versions = await db.query.publicationVersions.findMany({
      where: (v, { inArray }) => inArray(v.id, versionIds),
      columns: { id: true, body_md: true },
    });
    versionMap = new Map(versions.map(v => [v.id, v.body_md]));
  }

  const publicationsWithContent = publications.map(p => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    updatedAt: p.updated_at,
    bodyMd: p.current_version_id ? (versionMap.get(p.current_version_id) ?? null) : null,
  }));

  return (
    <RevisionClient
      cycle={{
        id: cycle.id,
        isoWeek: cycle.iso_week,
        year: cycle.year,
        status: cycle.status,
        startsAt: cycle.starts_at.toISOString(),
        endsAt: cycle.ends_at.toISOString(),
      }}
      consolidation={
        consolidation
          ? {
              id: consolidation.id,
              summaryMd: consolidation.internal_summary_md,
              status: consolidation.status,
              generatedAt: consolidation.generated_at.toISOString(),
            }
          : null
      }
      publications={publicationsWithContent}
    />
  );
}
