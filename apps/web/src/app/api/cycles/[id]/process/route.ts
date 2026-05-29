import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
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

const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
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
  const data = await res.json();
  return { ok: res.ok, data };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cycleId = params.id;

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { id: true, status: true },
  });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  logger.info({ cycleId, userId: session.user.id }, 'process cycle triggered');

  // 1. Cerrar
  const closeResult = await internalPost(`/api/internal/cycles/${cycleId}/close`, {});
  if (!closeResult.ok) {
    return NextResponse.json({ error: 'close failed', detail: closeResult.data }, { status: 500 });
  }

  // 2. Consolidar
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
