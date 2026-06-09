// POST /api/agenda/ical-tokens/[id]/revoke
// Revoca (invalida) un token de suscripción iCal. Solo el propio usuario puede revocarlo.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await db.query.icalTokens.findFirst({
    where: and(
      eq(schema.icalTokens.id, params.id),
      eq(schema.icalTokens.user_id, session.user.id),
    ),
    columns: { id: true, revoked_at: true },
  });

  if (!token) return NextResponse.json({ error: 'Token no encontrado' }, { status: 404 });
  if (token.revoked_at) return NextResponse.json({ ok: true, note: 'ya estaba revocado' });

  await db.update(schema.icalTokens).set({ revoked_at: new Date() })
    .where(eq(schema.icalTokens.id, params.id));

  return NextResponse.json({ ok: true });
}
