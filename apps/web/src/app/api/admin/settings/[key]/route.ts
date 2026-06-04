// Endpoint para actualizar un parámetro de configuración individual por su clave.
// PATCH /api/admin/settings/:key con { value } actualiza o crea el parámetro.
// Es un upsert (insert + on conflict update), por lo que siempre resulta en el valor actualizado.
// Solo el rol press_admin puede modificar la configuración.
import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { key: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { key } = params;
  const body = await req.json() as { value?: unknown };
  if (body.value === undefined) {
    return NextResponse.json({ error: 'value required' }, { status: 400 });
  }

  await db
    .insert(schema.systemSettings)
    .values({
      key,
      value: body.value as unknown as Record<string, unknown>,
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

  return NextResponse.json({ ok: true });
}
