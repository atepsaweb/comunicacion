// GET/PUT /api/agenda/notification-prefs
// Preferencias de notificación por secretario para el módulo Agenda.
//
// Estructura del JSON de prefs:
//   {
//     "secretariat":  { "7d": bool, "24h": bool, "12h": bool, "2h": bool },
//     "mobilization": { "7d": bool, "24h": bool, "12h": bool, "2h": bool }
//   }
//
// Ausencia de una clave = heredar reminder_config del evento (opt-out, no opt-in).
// Los eventos is_important ignoran estas prefs: siempre se mandan.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

type ReminderPrefs = {
  '7d': boolean;
  '24h': boolean;
  '12h': boolean;
  '2h': boolean;
};

type NotifPrefs = {
  secretariat?: ReminderPrefs;
  mobilization?: ReminderPrefs;
};

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await db.query.agendaNotificationPrefs.findFirst({
    where: eq(schema.agendaNotificationPrefs.user_id, session.user.id),
    columns: { prefs: true, updated_at: true },
  });

  return NextResponse.json({ prefs: row?.prefs ?? null, updated_at: row?.updated_at ?? null });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  if (!body.prefs || typeof body.prefs !== 'object') {
    return NextResponse.json({ error: 'prefs es requerido' }, { status: 400 });
  }

  const prefs = body.prefs as NotifPrefs;
  const userId = session.user.id;

  await db
    .insert(schema.agendaNotificationPrefs)
    .values({ user_id: userId, prefs, updated_at: new Date() })
    .onConflictDoUpdate({
      target: schema.agendaNotificationPrefs.user_id,
      set: { prefs, updated_at: new Date() },
    });

  return NextResponse.json({ ok: true });
}
