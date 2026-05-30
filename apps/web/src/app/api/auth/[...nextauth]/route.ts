import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type NextRequest } from 'next/server';

const nextAuthHandler = NextAuth(authOptions);

const SESSION_MAX_AGE_SECS = 30 * 24 * 60 * 60; // 30 días
const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const SESSION_COOKIE = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

type RouteCtx = { params: { nextauth: string[] } };
type AuthHandler = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;

/**
 * NextAuth v4 + Next.js 14 App Router no escribe maxAge en el header Set-Cookie
 * de la respuesta pese a estar configurado. Este wrapper intercepta la respuesta
 * y fuerza Max-Age en la cookie de sesión si falta, antes de enviarla al browser.
 *
 * IMPORTANTE: hay que reenviar `ctx` (params de la ruta) al handler de NextAuth;
 * sin eso falla con "Cannot read properties of undefined (reading 'nextauth')".
 */
async function handler(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const res = await (nextAuthHandler as unknown as AuthHandler)(req, ctx);

  // getSetCookie() devuelve cada Set-Cookie como elemento separado (Node 18+).
  type HeadersWithGetSetCookie = Headers & { getSetCookie(): string[] };
  const setCookies = (res.headers as HeadersWithGetSetCookie).getSetCookie();
  if (!setCookies.length) return res;

  const needsPatch = setCookies.some(
    c => c.startsWith(`${SESSION_COOKIE}=`) && !c.toLowerCase().includes('max-age'),
  );
  if (!needsPatch) return res;

  const patchedCookies = setCookies.map(c =>
    c.startsWith(`${SESSION_COOKIE}=`) && !c.toLowerCase().includes('max-age')
      ? `${c}; Max-Age=${SESSION_MAX_AGE_SECS}`
      : c,
  );

  const newHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') newHeaders.set(key, value);
  });
  patchedCookies.forEach(c => newHeaders.append('set-cookie', c));

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

export const GET = handler;
export const POST = handler;
