import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

// Forzar el nombre correcto de la cookie según NEXTAUTH_URL para que el middleware
// del Edge Runtime siempre busque la cookie con el prefijo correcto,
// independientemente de cómo detecte el protocolo desde el request.
const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const SESSION_COOKIE = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    secret: process.env.NEXTAUTH_SECRET,
    cookies: {
      sessionToken: {
        name: SESSION_COOKIE,
      },
    },
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  },
);

export const config = {
  // Proteger todo excepto login, api/auth, api/internal (usa shared secret propio) y assets estáticos
  matcher: [
    '/((?!login|api/auth|api/internal|_next/static|_next/image|favicon.ico).*)',
  ],
};
