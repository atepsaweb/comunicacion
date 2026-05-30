import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// POST /api/admin/prompts/[slug]/activate/[versionId] — activa una versión histórica
export async function POST(
  _req: NextRequest,
  { params }: { params: { slug: string; versionId: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { slug, versionId } = params;

  const target = await db.query.prompts.findFirst({
    where: and(eq(schema.prompts.id, versionId), eq(schema.prompts.slug, slug)),
    columns: { id: true, version: true, is_active: true },
  });

  if (!target) {
    return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
  }

  if (target.is_active) {
    return NextResponse.json({ ok: true, note: 'already_active' });
  }

  // Desactivar todas las versiones del slug y activar la solicitada
  await db
    .update(schema.prompts)
    .set({ is_active: false })
    .where(eq(schema.prompts.slug, slug));

  await db
    .update(schema.prompts)
    .set({ is_active: true })
    .where(eq(schema.prompts.id, versionId));

  return NextResponse.json({ ok: true, activatedVersion: target.version });
}
