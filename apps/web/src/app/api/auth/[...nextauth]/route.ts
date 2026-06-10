// Handler de NextAuth: gestiona todas las rutas de autenticación (/api/auth/*).
// Incluye un parche para agregar Max-Age a la cookie de sesión, ya que
// NextAuth v4 con CredentialsProvider emite la cookie sin Max-Age, lo que
// hace que el navegador la trate como cookie de sesión y la borre al cerrarse.
// Con este parche, la cookie dura 30 días (igual que SESSION_MAX_AGE en lib/auth.ts).
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type NextRequest } from 'next/server';

const nextAuthHandler = NextAuth(authOptions);

const SESSION_MAX_AGE_SECS = 30 * 24 * 60 * 60; // 30 días
const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const SESSION_COOKIE = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

type RouteCtx = { params: { nextauth: string[] } };
type AuthHandler = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;
type HeadersWithGetSetCookie = Headers & { getSetCookie(): string[] };

const isSessionCookie = (c: string): boolean => c.startsWith(`${SESSION_COOKIE}=`);
const lacksExpiry = (c: string): boolean => !/max-age|expires/i.test(c);

/**
 * NextAuth v4 con CredentialsProvider emite la cookie de sesión SIN Max-Age ni
 * Expires, así que el navegador la trata como cookie de sesión y la borra al
 * cerrarse. Este wrapper le agrega Max-Age (30 días) mutando los headers de la
 * respuesta in-place — reconstruir el Response re-serializaba el body y perdía
 * el parche.
 *
 * IMPORTANTE: hay que reenviar `ctx` (params de ruta) al handler de NextAuth, o
 * falla con "Cannot read properties of undefined (reading 'nextauth')".
 */
async function handler(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const res = await (nextAuthHandler as unknown as AuthHandler)(req, ctx);

  const headers = res.headers as HeadersWithGetSetCookie;
  if (typeof headers.getSetCookie !== 'function') return res;

  const cookies = headers.getSetCookie();
  const needsPatch = cookies.some(c => isSessionCookie(c) && lacksExpiry(c));
  if (!needsPatch) return res;

  const patched = cookies.map(c =>
    isSessionCookie(c) && lacksExpiry(c) ? `${c}; Max-Age=${SESSION_MAX_AGE_SECS}` : c,
  );

  headers.delete('set-cookie');
  for (const c of patched) headers.append('set-cookie', c);

  return res;
}

export const GET = handler;
export const POST = handler;
