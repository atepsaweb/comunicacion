// Página de revisión de publicaciones para el Secretario de Prensa (Julián).
// Solo accesible con rol press_admin.
// Muestra el consolidado semanal y todas las publicaciones generadas por la IA
// listas para que Julián las revise, edite y apruebe antes de publicar.
// También permite navegar semanas anteriores desde un selector de ciclos.
export const dynamic = 'force-dynamic';

import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { desc, inArray } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { RevisionClient } from './revision-client';

export default async function RevisionPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  // Todos los ciclos no-pending para navegación (últimos 24)
  const allCycles = await db.query.weeklyCycles.findMany({
    where: inArray(schema.weeklyCycles.status, ['open', 'closed', 'processed', 'published']),
    columns: { id: true, iso_week: true, year: true, status: true, starts_at: true, ends_at: true },
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    limit: 24,
  });

  // Ciclo a mostrar: el del queryParam, o el más reciente que NO esté publicado
  // (los publicados desaparecen de la vista principal — se acceden desde el archivo)
  const requestedId = typeof searchParams.cycleId === 'string' ? searchParams.cycleId : null;
  const cycle = requestedId
    ? (allCycles.find(c => c.id === requestedId) ?? allCycles[0])
    : allCycles.find(c => c.status !== 'published');

  if (!cycle) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-zinc-900">Revisión</h1>
        <p className="text-zinc-500 text-sm">
          No hay semana activa en este momento.{' '}
          {allCycles.length > 0 && (
            <a href="/reportes" className="underline hover:text-zinc-800">
              Ver archivo de semanas anteriores →
            </a>
          )}
        </p>
      </div>
    );
  }

  // Consolidación del ciclo seleccionado
  const consolidation = await db.query.consolidations.findFirst({
    where: (c, { eq }) => eq(c.cycle_id, cycle.id),
    columns: { id: true, internal_summary_md: true, status: true, generated_at: true, verification_notes_md: true },
  });

  // Publicaciones del ciclo con versión actual
  const publications = await db.query.publications.findMany({
    where: (p, { eq }) => eq(p.cycle_id, cycle.id),
    columns: { id: true, kind: true, status: true, current_version_id: true, updated_at: true },
    orderBy: [schema.publications.kind],
  });

  const versionIds = publications.map(p => p.current_version_id).filter(Boolean) as string[];

  let versionMap = new Map<string, string>();
  if (versionIds.length > 0) {
    const versions = await db.query.publicationVersions.findMany({
      where: (v, { inArray: inArr }) => inArr(v.id, versionIds),
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
              verificationNotes: consolidation.verification_notes_md ?? null,
            }
          : null
      }
      publications={publicationsWithContent}
      isHistoryView={requestedId !== null}
      allCycles={allCycles.map(c => ({
        id: c.id,
        isoWeek: c.iso_week,
        year: c.year,
        status: c.status,
        startsAt: c.starts_at.toISOString(),
      }))}
    />
  );
}
