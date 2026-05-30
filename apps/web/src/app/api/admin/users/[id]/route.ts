import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = params;

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: { id: true, phone_e164: true },
  });
  if (!existing) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const body = await req.json() as {
    full_name?: string;
    phone_e164?: string;
    role?: string;
    position?: string;
    notes?: string;
    is_active?: boolean;
  };

  const updates: Partial<typeof schema.users.$inferInsert> = {};

  if (body.full_name !== undefined) updates.full_name = body.full_name.trim();
  if (body.position !== undefined) updates.position = body.position?.trim() ?? null;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() ?? null;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  if (body.role !== undefined) {
    if (!['secretary', 'executive', 'press_admin'].includes(body.role)) {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
    }
    updates.role = body.role as 'secretary' | 'executive' | 'press_admin';
  }

  const phoneChanged = body.phone_e164 !== undefined && body.phone_e164 !== existing.phone_e164;

  if (phoneChanged) {
    const taken = await db.query.users.findFirst({
      where: eq(schema.users.phone_e164, body.phone_e164!),
      columns: { id: true },
    });
    if (taken && taken.id !== id) {
      return NextResponse.json({ error: 'Ya existe un usuario con ese teléfono' }, { status: 409 });
    }
    updates.phone_e164 = body.phone_e164!.trim();
    // Limpiar OTP activos para evitar inconsistencias
    await db.delete(schema.otpCodes).where(eq(schema.otpCodes.user_id, id));
  }

  updates.updated_at = new Date();

  await db.update(schema.users).set(updates).where(eq(schema.users.id, id));

  return NextResponse.json({ ok: true, phoneChanged });
}
