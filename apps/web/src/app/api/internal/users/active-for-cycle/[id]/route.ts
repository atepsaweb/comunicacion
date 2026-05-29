import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, params.id),
    columns: { id: true, starts_at: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  // Cycle date range as YYYY-MM-DD strings for comparison with date columns
  // starts_at = Monday 03:00 UTC = Monday 00:00 ART → Monday date
  const cycleStartDate = cycle.starts_at.toISOString().split('T')[0];
  // ends_at = next Monday 02:59 UTC = Sunday 23:59 ART → Sunday = Monday + 6 days
  const cycleEndDate = new Date(cycle.starts_at);
  cycleEndDate.setUTCDate(cycle.starts_at.getUTCDate() + 6);
  const cycleEndDateStr = cycleEndDate.toISOString().split('T')[0];

  const allUsers = await db.query.users.findMany({
    where: eq(schema.users.is_active, true),
    columns: { id: true, full_name: true, phone_e164: true, role: true },
  });

  // Absences that overlap this cycle: starts_on <= cycleEnd AND ends_on >= cycleStart
  const onLeaveRows = await db.query.absences.findMany({
    columns: { user_id: true, type: true },
    where: and(
      lte(schema.absences.starts_on, cycleEndDateStr),
      gte(schema.absences.ends_on, cycleStartDate),
    ),
  });

  const onLeaveIds = new Set(onLeaveRows.map(a => a.user_id));
  const activeUsers = allUsers.filter(u => !onLeaveIds.has(u.id));

  return NextResponse.json({
    users: activeUsers.map(u => ({
      id: u.id,
      fullName: u.full_name,
      phoneE164: u.phone_e164,
      role: u.role,
    })),
    count: activeUsers.length,
    onLeaveCount: onLeaveIds.size,
  });
}
