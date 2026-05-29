import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
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
