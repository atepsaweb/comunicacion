// PATCH/DELETE de un afiliado por id.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, status: 401 };
  if (session.user.role !== 'press_admin') return { ok: false as const, status: 403 };
  return { ok: true as const, session };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status });

  const body = await req.json() as Record<string, unknown>;
  const update: Partial<typeof schema.affiliates.$inferInsert> = {};
  const text = (k: string) =>
    typeof body[k] === 'string' ? (body[k] as string).trim() || null : undefined;

  const setIf = <K extends keyof typeof update>(k: K, v: typeof update[K] | undefined) => {
    if (v !== undefined) update[k] = v;
  };
  setIf('last_name',   text('last_name') ?? undefined);
  setIf('first_name',  text('first_name') ?? undefined);
  setIf('aeropuerto',  text('aeropuerto'));
  setIf('organismo',   text('organismo'));
  setIf('rama',        text('rama'));
  setIf('tipo',        text('tipo'));
  setIf('vigencia',    text('vigencia'));
  setIf('dependency',  text('dependency'));
  setIf('position',    text('position'));
  setIf('dni',         text('dni'));
  setIf('legajo',      text('legajo'));
  setIf('email',       text('email'));
  setIf('phone_e164',  text('phone_e164'));
  setIf('notes',       text('notes'));
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
  update.updated_at = new Date();

  await db.update(schema.affiliates).set(update).where(eq(schema.affiliates.id, params.id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status });

  await db.delete(schema.affiliates).where(eq(schema.affiliates.id, params.id));
  return NextResponse.json({ ok: true });
}
