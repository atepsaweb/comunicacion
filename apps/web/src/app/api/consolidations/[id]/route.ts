// API para editar el texto del consolidado semanal interno.
// Julián puede editar el Markdown del consolidado desde el panel de revisión
// antes de aprobarlo. Solo el rol press_admin puede hacerlo.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

type PatchBody = { internal_summary_md: string };

// PATCH /api/consolidations/:id — editar el texto del consolidado interno
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { internal_summary_md } = (await req.json()) as PatchBody;
  if (!internal_summary_md?.trim()) {
    return NextResponse.json({ error: 'internal_summary_md required' }, { status: 400 });
  }

  const existing = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.id, params.id),
    columns: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db
    .update(schema.consolidations)
    .set({ internal_summary_md: internal_summary_md.trim() })
    .where(eq(schema.consolidations.id, params.id));

  return NextResponse.json({ ok: true });
}
