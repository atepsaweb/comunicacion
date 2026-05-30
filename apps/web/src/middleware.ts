import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const COOKIE_NAME = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

// Rutas que NO necesitan autenticación
const PUBLIC = /^(\/login|\/api\/auth|\/api\/internal|\/api\/health|\/favicon\.ico|\/_next\/)/;

// ─── Rate limiting para /api/internal/* ────────────────────────────────────
const rlMap = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 100;
const RL_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rlMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rlMap.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  if (entry.count >= RL_MAX) return true;
  entry.count++;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/internal/')) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    return NextResponse.next();
  }

  if (PUBLIC.test(pathname)) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: COOKIE_NAME,
    secureCookie: isSecure,
  });

  if (token) return NextResponse.next();

  const login = new URL('/login', req.url);
  login.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
