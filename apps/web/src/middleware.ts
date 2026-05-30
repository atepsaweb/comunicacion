import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const COOKIE_NAME = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

// Rutas que NO necesitan autenticación
const PUBLIC = /^(\/login|\/api\/auth|\/api\/internal|\/api\/debug-auth|\/favicon\.ico|\/_next\/)/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
