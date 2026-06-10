// API de listado de prompts activos.
// Devuelve todos los prompts con is_active=true, ordenados por slug.
// Lo usa el panel de administración de prompts para mostrar la lista inicial.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// GET /api/admin/prompts — lista todos los slugs con su versión activa
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const activePrompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.is_active, true),
    columns: {
      id: true,
      slug: true,
      version: true,
      model_hint: true,
      notes: true,
      created_at: true,
      created_by: true,
    },
    orderBy: [schema.prompts.slug],
  });

  return NextResponse.json({ prompts: activePrompts });
}
