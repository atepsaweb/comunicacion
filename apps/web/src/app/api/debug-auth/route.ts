import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Endpoint temporal de diagnóstico — NO protegido por middleware
// Visitar: https://panel.atepsa.org.ar/api/debug-auth
// Mostrará qué cookies llegan y si el JWT es válido
// ELIMINAR después del diagnóstico

const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const COOKIE_NAME = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Nombres de todas las cookies (sin valores, para no exponer tokens)
  const cookieNames = req.cookies.getAll().map(c => c.name);
  const hasSessionCookie = req.cookies.has(COOKIE_NAME);
  const sessionCookieLen = req.cookies.get(COOKIE_NAME)?.value?.length ?? 0;

  let tokenResult: { ok: boolean; id?: string; role?: string; exp?: number; iat?: number; error?: string } = { ok: false };
  try {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: COOKIE_NAME,
      secureCookie: isSecure,
    });
    if (token) {
      tokenResult = {
        ok: true,
        id: token.id as string | undefined,
        role: token.role as string | undefined,
        exp: token.exp as number | undefined,
        iat: token.iat as number | undefined,
      };
    } else {
      tokenResult = { ok: false, error: 'getToken returned null' };
    }
  } catch (e) {
    tokenResult = { ok: false, error: String(e) };
  }

  return NextResponse.json({
    cookieName: COOKIE_NAME,
    isSecure,
    secret_present: !!process.env.NEXTAUTH_SECRET,
    nextauth_url: process.env.NEXTAUTH_URL ?? null,
    cookieNames,
    hasSessionCookie,
    sessionCookieLen,
    token: tokenResult,
    now: new Date().toISOString(),
  });
}
