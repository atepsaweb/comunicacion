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

  const body = await req.json() as {
    last_name?: string;
    first_name?: string;
    dependency?: string;
    position?: string;
    dni?: string;
    legajo?: string;
    email?: string;
    phone_e164?: string;
    notes?: string;
    is_active?: boolean;
  };
  const last_name = body.last_name?.trim();
  const first_name = body.first_name?.trim();
  if (!last_name || !first_name) {
    return NextResponse.json({ error: 'apellido y nombre son requeridos' }, { status: 400 });
  }

  const [row] = await db
    .insert(schema.affiliates)
    .values({
      last_name,
      first_name,
      dependency: body.dependency?.trim() || null,
      position: body.position?.trim() || null,
      dni: body.dni?.trim() || null,
      legajo: body.legajo?.trim() || null,
      email: body.email?.trim() || null,
      phone_e164: body.phone_e164?.trim() || null,
      notes: body.notes?.trim() || null,
      is_active: body.is_active ?? true,
      created_by: auth.session.user.id,
    })
    .returning({ id: schema.affiliates.id });

  return NextResponse.json({ ok: true, id: row.id });
}
