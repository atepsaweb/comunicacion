// Endpoint para que el admin (Julián) gestione el link personal de acceso
// de un usuario:
//   POST   → genera un link nuevo (revoca los previos y devuelve la URL completa)
//   DELETE → revoca todos los links activos del usuario
//   GET    → devuelve info del link activo (sin el token raw)
//
// El token raw sólo se ve en la respuesta del POST. Si el admin lo pierde,
// genera uno nuevo: el viejo queda revocado automáticamente.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  createAccessToken,
  revokeAllAccessTokensForUser,
  getActiveAccessTokenInfo,
} from '@/lib/access-tokens';
import { logger } from '@/lib/logger';

function buildLoginUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? 'https://panel.atepsa.org.ar';
  return `${base.replace(/\/$/, '')}/login/${token}`;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.user.role !== 'press_admin') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const, session };
}

async function findUser(id: string) {
  return db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: { id: true, full_name: true, is_active: true },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const user = await findUser(params.id);
  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  if (!user.is_active) {
    return NextResponse.json({ error: 'Usuario inactivo' }, { status: 400 });
  }

  const created = await createAccessToken({
    userId: user.id,
    createdByUserId: auth.session.user.id,
  });

  logger.info(
    { userId: user.id, fullName: user.full_name, tokenId: created.id, by: auth.session.user.id },
    'access-token created',
  );

  return NextResponse.json({
    tokenId: created.id,
    loginUrl: buildLoginUrl(created.token),
    expiresAt: created.expiresAt.toISOString(),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const user = await findUser(params.id);
  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  await revokeAllAccessTokensForUser(user.id);
  logger.info({ userId: user.id, by: auth.session.user.id }, 'access-tokens revoked');
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const info = await getActiveAccessTokenInfo(params.id);
  if (!info) return NextResponse.json({ active: false });

  return NextResponse.json({
    active: true,
    tokenId: info.id,
    createdAt: info.createdAt.toISOString(),
    expiresAt: info.expiresAt.toISOString(),
    lastUsedAt: info.lastUsedAt?.toISOString() ?? null,
  });
}
