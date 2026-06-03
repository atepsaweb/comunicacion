// Middleware de Next.js: se ejecuta en cada request antes de llegar a la página o API.
// Se encarga de dos cosas:
//   1. Proteger las rutas del panel web: redirige al login si no hay sesión válida
//   2. Rate limiting para los endpoints internos de n8n: evita que alguien los llame de más
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const COOKIE_NAME = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

// Rutas que NO necesitan autenticación (accesibles sin estar logueado)
const PUBLIC = /^(\/login|\/privacy|\/api\/auth|\/api\/internal|\/api\/webhooks|\/api\/health|\/favicon\.ico|\/_next\/)/;

// ─── Rate limiting para /api/internal/* ────────────────────────────────────
// Limita cuántos requests puede hacer una IP en un minuto para los endpoints internos.
// Esto previene ataques de fuerza bruta aunque n8n esté en el mismo servidor.
const rlMap = new Map<string, { count: number; resetAt: number }>();
// Máximo de requests por IP por ventana de tiempo
const RL_MAX = 100;
// Ventana de tiempo en milisegundos (60 segundos)
const RL_WINDOW_MS = 60_000;

// Retorna true si la IP superó el límite de requests en el período actual.
// Usa una ventana fija (no deslizante) para simplificar la implementación.
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

  // Los endpoints internos pasan por rate limiting pero no por autenticación de sesión
  // (se autentican con el secret compartido en cada request individual)
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

  // Las rutas públicas pasan directo sin verificación
  if (PUBLIC.test(pathname)) return NextResponse.next();

  // Para el resto: verificar que haya un token JWT de sesión válido en la cookie
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: COOKIE_NAME,
    secureCookie: isSecure,
  });

  // Si hay sesión válida, dejar pasar
  if (token) return NextResponse.next();

  // Si no hay sesión, redirigir al login guardando la URL original para volver después
  const login = new URL('/login', req.url);
  login.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
