import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { uuidv7 } from 'uuidv7';
import type { ReminderConfig } from '@/lib/ai/prompts/parse-event';
import { REMINDER_DEFAULTS } from '@/lib/ai/prompts/parse-event';
import { onEventConfirmed } from '@/lib/agenda/on-event-confirmed';
import { notifyProposal } from '@/lib/agenda/notify-proposal';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'from y to son requeridos (YYYY-MM-DD)' }, { status: 400 });
  }

  const fromDate = new Date(`${from}T00:00:00-03:00`);
  const toDate = new Date(`${to}T23:59:59-03:00`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 });
  }

  const dateFilter = and(
    gte(schema.events.starts_at, fromDate),
    lte(schema.events.starts_at, toDate),
  );

  // Visibilidad total (2026-06-09): todos los eventos son públicos para el
  // Secretariado — el objetivo es optimizar la comunicación interna.
  // Solo se ocultan los pending_confirmation (borradores de WhatsApp sin confirmar).
  const visibilityFilter = ne(schema.events.status, 'pending_confirmation' as const);

  const rows = await db
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
      created_at: schema.events.created_at,
      creator_name: schema.users.full_name,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.created_by, schema.users.id))
    .where(and(visibilityFilter, dateFilter))
    .orderBy(schema.events.starts_at);

  return NextResponse.json({ events: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title es requerido' }, { status: 400 });
  }
  if (!['personal', 'secretariat', 'mobilization'].includes(body.type as string)) {
    return NextResponse.json({ error: 'type inválido' }, { status: 400 });
  }
  if (typeof body.starts_at !== 'string') {
    return NextResponse.json({ error: 'starts_at es requerido' }, { status: 400 });
  }

  const startsAt = new Date(body.starts_at as string);
  if (isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: 'starts_at inválido' }, { status: 400 });
  }

  const endsAt =
    typeof body.ends_at === 'string' && body.ends_at
      ? new Date(body.ends_at as string)
      : null;
  if (endsAt && isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: 'ends_at inválido' }, { status: 400 });
  }

  const userId = session.user.id;
  const role = session.user.role;
  const eventType = body.type as 'personal' | 'secretariat' | 'mobilization';

  const status: 'confirmed' | 'proposed' =
    eventType === 'personal' || role !== 'secretary' ? 'confirmed' : 'proposed';

  const defaultConfig = (REMINDER_DEFAULTS[eventType] ?? REMINDER_DEFAULTS['personal']) as ReminderConfig;
  const reminderConfig: ReminderConfig =
    body.reminder_config != null && typeof body.reminder_config === 'object'
      ? (body.reminder_config as ReminderConfig)
      : defaultConfig;

  const eventId = uuidv7();

  const [event] = await db
    .insert(schema.events)
    .values({
      id: eventId,
      title: (body.title as string).trim(),
      type: eventType,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: body.all_day === true,
      location: typeof body.location === 'string' ? body.location : null,
      description_md: typeof body.description_md === 'string' ? body.description_md : null,
      created_by: userId,
      requires_confirmation: eventType !== 'personal',
      is_important: eventType === 'mobilization',
      reminder_config: reminderConfig,
      source: 'panel',
    })
    .returning({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      status: schema.events.status,
      starts_at: schema.events.starts_at,
    });

  if (status === 'confirmed') {
    onEventConfirmed(eventId).catch(err =>
      logger.error({ err, eventId }, 'POST /api/agenda/events: error en onEventConfirmed'),
    );
  }

  if (status === 'proposed') {
    const creatorName = session.user.name ?? 'Secretario';
    notifyProposal(
      { id: event!.id, title: event!.title, type: eventType, starts_at: event!.starts_at, all_day: body.all_day === true, location: typeof body.location === 'string' ? body.location : null },
      creatorName,
    ).catch(err => logger.error({ err, eventId }, 'POST /api/agenda/events: error en notifyProposal'));
  }

  return NextResponse.json({ event }, { status: 201 });
}
