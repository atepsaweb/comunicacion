// Endpoint que Julián activa desde el panel para procesar un ciclo cerrado.
// Orquesta en secuencia todas las llamadas de IA necesarias para generar el consolidado
// y los borradores de publicación. Es el "botón de proceso" del ciclo.
import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

// Este endpoint orquesta la secuencia de procesamiento del ciclo:
// 1. Cierra el ciclo (si no está cerrado)
// 2. Genera el consolidado interno
// 3. Genera los 3 drafts de publicación
//
// Llama a los endpoints internos via fetch interno (Docker: http://web:3000 en prod,
// pero como corre en el mismo proceso Next.js, usamos las funciones directamente).

// Desde dentro del container, localhost:3000 es más directo que pasar por nginx
const BASE = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.INTERNAL_API_SECRET ?? '';

async function internalPost(path: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // El endpoint devolvió HTML (Next.js 500 sin manejador de error) — no es JSON
    data = { error: `non-json response (http ${res.status})` };
  }
  return { ok: res.ok, data };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cycleId = params.id;

  try {
    return await processHandler(cycleId, session.user.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, cycleId }, 'process cycle unhandled error');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function processHandler(cycleId: string, userId: string): Promise<NextResponse> {
  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { id: true, status: true },
  });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  logger.info({ cycleId, userId }, 'process cycle triggered');

  // Limpiar consolidado y publicaciones anteriores para permitir regeneración libre.
  // El cierre del ciclo ocurre solo por el job programado, no desde este botón.
  const existingConsolidation = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.cycle_id, cycleId),
    columns: { id: true },
  });
  if (existingConsolidation) {
    const existingPubs = await db.query.publications.findMany({
      where: eq(schema.publications.consolidation_id, existingConsolidation.id),
      columns: { id: true },
    });
    if (existingPubs.length > 0) {
      const pubIds = existingPubs.map(p => p.id);
      await db.delete(schema.publicationVersions).where(inArray(schema.publicationVersions.publication_id, pubIds));
      await db.delete(schema.publications).where(inArray(schema.publications.id, pubIds));
    }
    await db.delete(schema.consolidations).where(eq(schema.consolidations.id, existingConsolidation.id));
    logger.info({ cycleId, consolidationId: existingConsolidation.id }, 'consolidación anterior eliminada para regeneración');
  }

  // Consolidar
  const consolidateResult = await internalPost('/api/internal/ai/consolidate', { cycleId });
  if (!consolidateResult.ok) {
    return NextResponse.json({ error: 'consolidate failed', detail: consolidateResult.data }, { status: 500 });
  }

  // 3. Drafts en paralelo
  const [instagram, x, newsletter] = await Promise.all([
    internalPost('/api/internal/ai/draft-publication', { cycleId, kind: 'social_instagram' }),
    internalPost('/api/internal/ai/draft-publication', { cycleId, kind: 'social_x' }),
    internalPost('/api/internal/ai/draft-publication', { cycleId, kind: 'newsletter' }),
  ]);

  const failed = [
    { kind: 'social_instagram', r: instagram },
    { kind: 'social_x', r: x },
    { kind: 'newsletter', r: newsletter },
  ].filter(d => !d.r.ok);

  if (failed.length > 0) {
    logger.warn({ cycleId, failed: failed.map(f => f.kind) }, 'some drafts failed');
  }

  logger.info({ cycleId }, 'process cycle completed');

  return NextResponse.json({
    ok: true,
    consolidate: consolidateResult.data,
    drafts: {
      social_instagram: instagram.data,
      social_x: x.data,
      newsletter: newsletter.data,
    },
  });
}
