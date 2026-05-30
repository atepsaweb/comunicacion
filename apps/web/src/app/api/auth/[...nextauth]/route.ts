import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type NextRequest } from 'next/server';

const nextAuthHandler = NextAuth(authOptions);

const SESSION_MAX_AGE_SECS = 30 * 24 * 60 * 60; // 30 días
const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const SESSION_COOKIE = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

/**
 * NextAuth v4 + Next.js 14 App Router tiene un bug conocido donde el maxAge
 * configurado en authOptions.cookies no se escribe en el header Set-Cookie de la
 * respuesta. Este wrapper intercepta la respuesta y fuerza Max-Age en la cookie
 * de sesión antes de que llegue al browser.
 */
async function handler(req: NextRequest): Promise<Response> {
  const res = await (nextAuthHandler as unknown as (req: NextRequest) => Promise<Response>)(req);

  // getSetCookie() devuelve cada Set-Cookie como elemento separado del array
  // (Node 18+). Con get('set-cookie') se concatenarían incorrectamente.
  type HeadersWithGetSetCookie = Headers & { getSetCookie(): string[] };
  const setCookies = (res.headers as HeadersWithGetSetCookie).getSetCookie();
  if (!setCookies.length) return res;

  // Solo parchear si hay una cookie de sesión sin Max-Age
  const needsPatch = setCookies.some(
    c => c.startsWith(`${SESSION_COOKIE}=`) && !c.toLowerCase().includes('max-age'),
  );
  if (!needsPatch) return res;

  const patchedCookies = setCookies.map(c =>
    c.startsWith(`${SESSION_COOKIE}=`) && !c.toLowerCase().includes('max-age')
      ? `${c}; Max-Age=${SESSION_MAX_AGE_SECS}`
      : c,
  );

  // Reconstruir la respuesta con las cookies parcheadas.
  // Usamos forEach para copiar headers (excluye set-cookie) y append para cada cookie.
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
