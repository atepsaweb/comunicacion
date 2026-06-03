// Helpers para gestionar tokens personales de acceso al panel.
// El token raw sólo se devuelve al momento de crearlo: una vez generado, no
// hay forma de recuperarlo desde la DB sin guardarlo. Si el admin lo pierde,
// crea uno nuevo (lo cual revoca los anteriores del mismo usuario).
import crypto from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { accessTokens } from '@/db/schema';

/** Duración por defecto de un token nuevo. */
export const DEFAULT_TOKEN_TTL_DAYS = 60;

export type CreatedAccessToken = {
  id: string;
  token: string;
  expiresAt: Date;
};

/**
 * Genera un token nuevo para `userId` y revoca cualquier token activo previo
 * del mismo usuario. Devuelve el token raw para mostrar al admin una sola vez.
 */
export async function createAccessToken(opts: {
  userId: string;
  createdByUserId: string;
  ttlDays?: number;
}): Promise<CreatedAccessToken> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (opts.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS) * 86_400_000);

  // Revocar tokens activos previos del mismo user (un solo link activo por persona).
  await db
    .update(accessTokens)
    .set({ revoked_at: new Date() })
    .where(and(eq(accessTokens.user_id, opts.userId), isNull(accessTokens.revoked_at)));

  const [row] = await db
    .insert(accessTokens)
    .values({
      user_id: opts.userId,
      token,
      created_by: opts.createdByUserId,
      expires_at: expiresAt,
    })
    .returning({
      id: accessTokens.id,
      token: accessTokens.token,
      expires_at: accessTokens.expires_at,
    });

  return { id: row.id, token: row.token, expiresAt: row.expires_at };
}

/**
 * Valida un token. Si es válido marca `last_used_at` y devuelve `userId`.
 * Devuelve null si el token no existe, está vencido o fue revocado.
 */
export async function validateAccessToken(token: string): Promise<{ userId: string } | null> {
  if (!token) return null;
  const now = new Date();
  const row = await db.query.accessTokens.findFirst({
    where: and(
      eq(accessTokens.token, token),
      gt(accessTokens.expires_at, now),
      isNull(accessTokens.revoked_at),
    ),
    columns: { id: true, user_id: true },
  });
  if (!row) return null;
  await db
    .update(accessTokens)
    .set({ last_used_at: now })
    .where(eq(accessTokens.id, row.id));
  return { userId: row.user_id };
}

/** Revoca todos los tokens activos del usuario. Devuelve cuántos revocó. */
export async function revokeAllAccessTokensForUser(userId: string): Promise<void> {
  await db
    .update(accessTokens)
    .set({ revoked_at: new Date() })
    .where(and(eq(accessTokens.user_id, userId), isNull(accessTokens.revoked_at)));
}

/** Trae info del token activo de un usuario (sin el token raw). */
export async function getActiveAccessTokenInfo(userId: string): Promise<{
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
} | null> {
  const now = new Date();
  const row = await db.query.accessTokens.findFirst({
    where: and(
      eq(accessTokens.user_id, userId),
      gt(accessTokens.expires_at, now),
      isNull(accessTokens.revoked_at),
    ),
    columns: {
      id: true,
      created_at: true,
      expires_at: true,
      last_used_at: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  };
}
