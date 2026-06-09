// GET  /api/agenda/ical-tokens    → lista los tokens activos del usuario
// POST /api/agenda/ical-tokens    → genera (o regenera) el token para un scope
//
// Scopes: 'all' | 'secretariat' | 'personal'
// Si ya existe un token activo para ese scope, lo revoca y genera uno nuevo.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { uuidv7 } from 'uuidv7';

const VALID_SCOPES = ['all', 'secretariat', 'personal'] as const;
type Scope = (typeof VALID_SCOPES)[number];

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tokens = await db
    .select({
      id: schema.icalTokens.id,
      scope: schema.icalTokens.scope,
      token: schema.icalTokens.token,
      last_accessed_at: schema.icalTokens.last_accessed_at,
      created_at: schema.icalTokens.created_at,
    })
    .from(schema.icalTokens)
    .where(
      and(
        eq(schema.icalTokens.user_id, session.user.id),
        isNull(schema.icalTokens.revoked_at),
      ),
    )
    .orderBy(schema.icalTokens.scope);

  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const scope = body.scope as string;

  if (!VALID_SCOPES.includes(scope as Scope)) {
    return NextResponse.json({ error: `scope inválido. Valores: ${VALID_SCOPES.join(', ')}` }, { status: 400 });
  }

  const userId = session.user.id;

  // Revocar cualquier token activo existente para este scope
  await db.update(schema.icalTokens).set({
    revoked_at: new Date(),
  }).where(
    and(
      eq(schema.icalTokens.user_id, userId),
      eq(schema.icalTokens.scope, scope as Scope),
      isNull(schema.icalTokens.revoked_at),
    ),
  );

  // Crear nuevo token
  const newToken = generateToken();
  const [row] = await db.insert(schema.icalTokens).values({
    id: uuidv7(),
    user_id: userId,
    scope: scope as Scope,
    token: newToken,
  }).returning({
    id: schema.icalTokens.id,
    scope: schema.icalTokens.scope,
    token: schema.icalTokens.token,
    created_at: schema.icalTokens.created_at,
  });

  return NextResponse.json({ token: row }, { status: 201 });
}
