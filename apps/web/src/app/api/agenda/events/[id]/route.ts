import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import type { ReminderConfig } from '@/lib/ai/prompts/parse-event';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      status: schema.events.status,
      starts_at: schema.events.starts_at,
      ends_at: schema.events.ends_at,
      all_day: schema.events.all_day,
      location: schema.events.location,
      description_md: schema.events.description_md,
      created_by: schema.events.created_by,
      requires_confirmation: schema.events.requires_confirmation,
      is_important: schema.events.is_important,
      reminder_config: schema.events.reminder_config,
      cancellation_reason: schema.events.cancellation_reason,
      cancelled_at: schema.events.cancelled_at,
      outcome_md: schema.events.outcome_md,
      created_at: schema.events.created_at,
      updated_at: schema.events.updated_at,
      creator_name: schema.users.full_name,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.created_by, schema.users.id))
    .where(eq(schema.events.id, params.id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });

  const { id: userId, role } = session.user;
  const isOwner = row.created_by === userId;
  const isAdminOrExec = role === 'press_admin' || role === 'executive';
  const isPublic =
    row.type !== 'personal' &&
    (row.status === 'confirmed' || row.status === 'done' || row.status === 'proposed');

  if (!isOwner && !isAdminOrExec && !isPublic) {
    return NextResponse.json({ error: 'No tenés acceso a este evento' }, { status: 403 });
  }

  return NextResponse.json({ event: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [existing] = await db
    .select({
      id: schema.events.id,
      status: schema.events.status,
      created_by: schema.events.created_by,
    })
    .from(schema.events)
    .where(eq(schema.events.id, params.id))
    .limit(1);

  if (!existing) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });

  const { id: userId, role } = session.user;
  if (existing.created_by !== userId && role !== 'press_admin') {
    return NextResponse.json({ error: 'Solo el creador o el administrador pueden editar' }, { status: 403 });
  }
  if (existing.status === 'cancelled' || existing.status === 'done') {
    return NextResponse.json({ error: 'No se puede editar un evento cancelado o finalizado' }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const updates: Partial<typeof schema.events.$inferInsert> = {};

  if (typeof body.title === 'string' && body.title.trim()) {
    updates.title = body.title.trim();
  }
  if ('description_md' in body) {
    updates.description_md = typeof body.description_md === 'string' ? body.description_md : null;
  }
  if (typeof body.starts_at === 'string') {
    const d = new Date(body.starts_at);
    if (!isNaN(d.getTime())) updates.starts_at = d;
  }
  if ('ends_at' in body) {
    const d = typeof body.ends_at === 'string' && body.ends_at ? new Date(body.ends_at) : null;
    updates.ends_at = d && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof body.all_day === 'boolean') {
    updates.all_day = body.all_day;
  }
  if ('location' in body) {
    updates.location = typeof body.location === 'string' ? body.location : null;
  }
  if (body.reminder_config != null && typeof body.reminder_config === 'object') {
    updates.reminder_config = body.reminder_config as ReminderConfig;
  }
  // press_admin puede aprobar eventos propuestos
  if (role === 'press_admin' && body.status === 'confirmed' && existing.status === 'proposed') {
    updates.status = 'confirmed';
    updates.approved_by = userId;
    updates.approved_at = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  updates.updated_at = new Date();

  const [updated] = await db
    .update(schema.events)
    .set(updates)
    .where(eq(schema.events.id, params.id))
    .returning({
      id: schema.events.id,
      title: schema.events.title,
      status: schema.events.status,
      starts_at: schema.events.starts_at,
    });

  return NextResponse.json({ event: updated });
}
