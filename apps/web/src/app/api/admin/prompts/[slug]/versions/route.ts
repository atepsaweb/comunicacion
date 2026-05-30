import { NextRequest, NextResponse } from 'next/server';
import { eq, max } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// POST /api/admin/prompts/[slug]/versions — crea nueva versión y la activa
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { slug } = params;
  const body = await req.json() as {
    system_prompt: string;
    user_template: string;
    model_hint?: string;
    notes?: string;
  };

  if (!body.system_prompt?.trim()) {
    return NextResponse.json({ error: 'system_prompt es requerido' }, { status: 400 });
  }
  if (!body.user_template?.trim()) {
    return NextResponse.json({ error: 'user_template es requerido' }, { status: 400 });
  }

  // Calcular próxima versión
  const result = await db
    .select({ maxVersion: max(schema.prompts.version) })
    .from(schema.prompts)
    .where(eq(schema.prompts.slug, slug));

  const currentMax = result[0]?.maxVersion ?? 0;
  const nextVersion = currentMax + 1;

  // Desactivar todas las versiones anteriores del slug
  await db
    .update(schema.prompts)
    .set({ is_active: false })
    .where(eq(schema.prompts.slug, slug));

  // Obtener model_hint de la versión activa previa si no se provee
  let modelHint = body.model_hint;
  if (!modelHint) {
    const prev = await db.query.prompts.findFirst({
      where: eq(schema.prompts.slug, slug),
      columns: { model_hint: true },
    });
    modelHint = prev?.model_hint ?? 'claude-haiku-4-5-20251001';
  }

  const [created] = await db
    .insert(schema.prompts)
    .values({
      slug,
      version: nextVersion,
      model_hint: modelHint,
      system_prompt: body.system_prompt.trim(),
      user_template: body.user_template.trim(),
      is_active: true,
      created_by: session.user.id,
      notes: body.notes?.trim() ?? null,
    })
    .returning({ id: schema.prompts.id, version: schema.prompts.version });

  return NextResponse.json({ promptId: created.id, version: created.version }, { status: 201 });
}
