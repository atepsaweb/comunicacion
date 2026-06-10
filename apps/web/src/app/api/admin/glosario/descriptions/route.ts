// Endpoint para guardar o actualizar la descripción de un término del glosario.
// Las descripciones se almacenan en system_settings como un objeto JSON { término: descripción }.
// Sirven para que Julián documente qué significa cada sigla o entidad,
// lo que en un futuro puede usarse para enriquecer el prompt de la IA.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq, sql } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const SETTINGS_KEY = 'glosario_descriptions';

// PATCH /api/admin/glosario/descriptions
// Body: { term: string, description: string }
// Guarda o actualiza la descripción de un término en system_settings (JSONB merge).
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { term?: string; description?: string };
  if (typeof body.term !== 'string' || !body.term.trim()) {
    return NextResponse.json({ error: 'term es requerido' }, { status: 400 });
  }
  if (typeof body.description !== 'string') {
    return NextResponse.json({ error: 'description es requerida' }, { status: 400 });
  }

  const term = body.term.trim();
  const description = body.description.trim();

  // Leer el JSON actual
  const existing = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, SETTINGS_KEY),
    columns: { value: true },
  });

  const current = (existing?.value ?? {}) as Record<string, string>;

  if (description === '') {
    delete current[term];
  } else {
    current[term] = description;
  }

  await db
    .insert(schema.systemSettings)
    .values({
      key: SETTINGS_KEY,
      value: current as unknown as Record<string, unknown>,
      updated_by: session.user.id,
      updated_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: {
        value: sql`excluded.value`,
        updated_by: session.user.id,
        updated_at: sql`now()`,
      },
    });

  return NextResponse.json({ ok: true, term, description });
}
