// Tokens personales de acceso al panel. Reemplazan al login por OTP de WhatsApp:
// el admin (Julián) genera un link único por secretario y lo comparte por canal
// humano. El primer click crea la sesión con cookie de larga duración.
//
// El token se considera válido si no está vencido y no fue revocado. Mientras
// dure puede usarse desde múltiples dispositivos (cada uno arma su cookie).
// Al regenerar un token nuevo para un usuario, revocamos los anteriores.
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';

export const accessTokens = appSchema.table('access_tokens', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // String url-safe random (43 chars de base64url). Lo que va en el link.
  token: text('token').notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Quién emitió el token (típicamente Julián).
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  // Última vez que se usó (para auditoría — no afecta la validez).
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
});

export type AccessToken = typeof accessTokens.$inferSelect;
export type NewAccessToken = typeof accessTokens.$inferInsert;
