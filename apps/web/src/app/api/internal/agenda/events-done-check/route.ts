// POST /api/internal/agenda/events-done-check
// Marca como 'done' todos los eventos confirmados cuya starts_at ya pasó.
// Llamado por el workflow n8n agenda-event-done-check (cron diario).
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // Marcar como done los eventos confirmados cuya starts_at ya pasó
  const updated = await db
    .update(schema.events)
    .set({ status: 'done', updated_at: now })
    .where(
      and(
        eq(schema.events.status, 'confirmed'),
        lt(schema.events.starts_at, now),
      ),
    )
    .returning({ id: schema.events.id });

  if (updated.length > 0) {
    const ids = updated.map(r => r.id);

    // Cancelar notificaciones pending que queden (excepto followup)
    for (const eventId of ids) {
      // Cancelar recordatorios previos al evento pero NO el followup
      await db.update(schema.eventNotifications).set({
        status: 'skipped',
        skip_reason: 'event_done',
      }).where(
        and(
          eq(schema.eventNotifications.event_id, eventId),
          eq(schema.eventNotifications.status, 'pending'),
          ne(schema.eventNotifications.kind, 'followup'),
        ),
      );
    }

    logger.info({ count: updated.length, ids }, 'events-done-check: eventos marcados como done');
  }

  return NextResponse.json({ marked_done: updated.length });
}
