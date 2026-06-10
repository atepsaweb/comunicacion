// Endpoint para archivar o desarchivar un término del glosario.
// Un término archivado no vuelve a aparecer en la lista del glosario,
// aunque siga siendo una mención frecuente. Sirve para descartar términos
// irrelevantes (nombres propios sin importancia, errores de transcripción, etc.).
// Los términos archivados se guardan en system_settings como JSON.
import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const ARCHIVED_KEY = 'glosario_archived';

// PATCH /api/admin/glosario/archive
// Body: { term: string, archived: boolean }
// archived: true  → ocultar para siempre (no vuelve a aparecer como sugerencia)
// archived: false → desarchivar
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { term?: string; archived?: boolean };
  if (typeof body.term !== 'string' || !body.term.trim()) {
    return NextResponse.json({ error: 'term es requerido' }, { status: 400 });
  }

  const term = body.term.trim();
  const archived = body.archived !== false; // default true

  const existing = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, ARCHIVED_KEY),
    columns: { value: true },
  });

  const current = (existing?.value ?? {}) as Record<string, boolean>;

  if (archived) {
    current[term] = true;
  } else {
    delete current[term];
  }

  await db
    .insert(schema.systemSettings)
    .values({
      key: ARCHIVED_KEY,
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

  return NextResponse.json({ ok: true, term, archived });
}
