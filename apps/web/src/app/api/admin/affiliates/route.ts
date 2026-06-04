// API CRUD de afiliados/delegados.
//   GET  → lista activos (con paginación opcional)
//   POST → crea uno nuevo
import { NextRequest, NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.user.role !== 'press_admin') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const, session };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rows = await db.query.affiliates.findMany({
    orderBy: [asc(schema.affiliates.last_name), asc(schema.affiliates.first_name)],
  });
  return NextResponse.json({ affiliates: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json() as Record<string, unknown>;
  const t = (k: string) => typeof body[k] === 'string' ? (body[k] as string).trim() || null : null;
  const last_name = t('last_name');
  const first_name = t('first_name');
  if (!last_name || !first_name) {
    return NextResponse.json({ error: 'apellido y nombre son requeridos' }, { status: 400 });
  }

  const [row] = await db
    .insert(schema.affiliates)
    .values({
      last_name,
      first_name,
      aeropuerto:  t('aeropuerto'),
      organismo:   t('organismo'),
      rama:        t('rama'),
      tipo:        t('tipo'),
      vigencia:    t('vigencia'),
      dependency:  t('dependency') ?? t('aeropuerto'),
      position:    t('position'),
      dni:         t('dni'),
      legajo:      t('legajo'),
      email:       t('email'),
      phone_e164:  t('phone_e164'),
      notes:       t('notes'),
      is_active:   typeof body.is_active === 'boolean' ? body.is_active : true,
      created_by:  auth.session.user.id,
    })
    .returning({ id: schema.affiliates.id });

  return NextResponse.json({ ok: true, id: row.id });
}
