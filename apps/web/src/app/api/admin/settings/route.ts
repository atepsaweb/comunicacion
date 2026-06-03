// API para leer y actualizar la configuración del sistema.
// GET: devuelve todos los parámetros de configuración (creando los defaults si faltan)
// POST: actualiza o crea un parámetro de configuración
// Solo el rol press_admin puede acceder a la configuración.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sql } from 'drizzle-orm';

const DEFAULT_SETTINGS: Array<{ key: string; value: unknown }> = [
  {
    key: 'report_categories',
    value: [
      'Negociación colectiva',
      'Relaciones institucionales',
      'Operacional',
      'Organización interna',
      'Condiciones laborales',
      'Legal',
      'Comunicación',
      'Otro',
    ],
  },
  { key: 'max_followup_per_burst', value: 2 },
  { key: 'cycle_timezone', value: 'America/Argentina/Buenos_Aires' },
];

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Seed defaults if they don't exist
  for (const def of DEFAULT_SETTINGS) {
    await db
      .insert(schema.systemSettings)
      .values({ key: def.key, value: def.value as unknown as Record<string, unknown> })
      .onConflictDoNothing();
  }

  const settings = await db.query.systemSettings.findMany({
    columns: { key: true, value: true, updated_at: true },
    orderBy: [schema.systemSettings.key],
  });

  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { key?: string; value?: unknown };
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  }

  await db
    .insert(schema.systemSettings)
    .values({
      key: body.key,
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
