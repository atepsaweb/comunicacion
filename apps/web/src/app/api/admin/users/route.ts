import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { uuidv7 } from 'uuidv7';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await db.query.users.findMany({
    columns: {
      id: true,
      full_name: true,
      phone_e164: true,
      role: true,
      position: true,
      is_active: true,
      notes: true,
      created_at: true,
      updated_at: true,
    },
    orderBy: [schema.users.full_name],
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    full_name: string;
    phone_e164: string;
    role?: string;
    position?: string;
    notes?: string;
    is_active?: boolean;
  };

  const { full_name, phone_e164, role = 'secretary', position, notes, is_active = true } = body;

  if (!full_name?.trim()) {
    return NextResponse.json({ error: 'full_name es requerido' }, { status: 400 });
  }
  if (!phone_e164?.trim()) {
    return NextResponse.json({ error: 'phone_e164 es requerido' }, { status: 400 });
  }
  if (!['secretary', 'executive', 'press_admin'].includes(role)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
  }

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.phone_e164, phone_e164),
    columns: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un usuario con ese teléfono' }, { status: 409 });
  }

  const [user] = await db
    .insert(schema.users)
    .values({
      id: uuidv7(),
      full_name: full_name.trim(),
      phone_e164: phone_e164.trim(),
      role: role as 'secretary' | 'executive' | 'press_admin',
      position: position?.trim() ?? null,
      notes: notes?.trim() ?? null,
      is_active,
    })
    .returning({ id: schema.users.id, full_name: schema.users.full_name });

  return NextResponse.json({ user }, { status: 201 });
}
