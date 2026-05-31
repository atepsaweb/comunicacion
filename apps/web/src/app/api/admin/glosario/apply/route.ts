import { NextRequest, NextResponse } from 'next/server';
import { eq, max } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const VOCAB_HEADER = 'VOCABULARIO FRECUENTE DETECTADO EN REPORTES:';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { terms: string[] };
  if (!Array.isArray(body.terms) || body.terms.length === 0) {
    return NextResponse.json({ error: 'terms es requerido y debe tener al menos un elemento' }, { status: 400 });
  }

  const terms = body.terms.map(t => t.trim()).filter(Boolean);
  if (terms.length === 0) {
    return NextResponse.json({ error: 'Ningún término válido recibido' }, { status: 400 });
  }

  const activePrompt = await db.query.prompts.findFirst({
    where: (p, { and, eq: eqFn }) => and(eqFn(p.slug, 'extract-report'), eqFn(p.is_active, true)),
    columns: {
      id: true,
      slug: true,
      version: true,
      system_prompt: true,
      user_template: true,
      model_hint: true,
    },
  });

  if (!activePrompt) {
    return NextResponse.json({ error: 'No existe prompt activo para extract-report' }, { status: 404 });
  }

  let updatedSystemPrompt: string;
  const sectionIndex = activePrompt.system_prompt.indexOf(VOCAB_HEADER);

  if (sectionIndex !== -1) {
    // Sección ya existe: insertar términos nuevos a continuación del header
    const beforeSection = activePrompt.system_prompt.slice(0, sectionIndex + VOCAB_HEADER.length);
    const afterHeader = activePrompt.system_prompt.slice(sectionIndex + VOCAB_HEADER.length);

    // Extraer la línea de términos actual (primera línea tras el header)
    const lineEnd = afterHeader.indexOf('\n');
    const currentTermsLine = lineEnd !== -1 ? afterHeader.slice(0, lineEnd).trim() : afterHeader.trim();
    const rest = lineEnd !== -1 ? afterHeader.slice(lineEnd) : '';

    const existingTerms = currentTermsLine
      ? currentTermsLine.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const allTerms = Array.from(new Set([...existingTerms, ...terms]));
    updatedSystemPrompt = `${beforeSection}\n${allTerms.join(', ')}${rest}`;
  } else {
    // Agregar sección nueva al final
    updatedSystemPrompt = `${activePrompt.system_prompt}\n\n${VOCAB_HEADER}\n${terms.join(', ')}`;
  }

  // Calcular próxima versión
  const result = await db
    .select({ maxVersion: max(schema.prompts.version) })
    .from(schema.prompts)
    .where(eq(schema.prompts.slug, 'extract-report'));

  const currentMax = result[0]?.maxVersion ?? 0;
  const nextVersion = currentMax + 1;

  // Desactivar versión activa
  await db
    .update(schema.prompts)
    .set({ is_active: false })
    .where(eq(schema.prompts.slug, 'extract-report'));

  const notes = `Glosario actualizado desde panel — términos: ${terms.join(', ')}`;

  const [created] = await db
    .insert(schema.prompts)
    .values({
      slug: 'extract-report',
      version: nextVersion,
      model_hint: activePrompt.model_hint,
      system_prompt: updatedSystemPrompt.trim(),
      user_template: activePrompt.user_template,
      is_active: true,
      created_by: session.user.id,
      notes,
    })
    .returning({ id: schema.prompts.id, version: schema.prompts.version });

  return NextResponse.json({ ok: true, newVersion: created.version, termsAdded: terms });
}
