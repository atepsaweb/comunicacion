import { redirect } from 'next/navigation';
import { getToken } from 'next-auth/jwt';
import { headers } from 'next/headers';

const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const COOKIE_NAME = `${isSecure ? '__Secure-' : ''}next-auth.session-token`;

// Si el usuario ya tiene sesión válida, lo mandamos al dashboard directamente.
// Esto evita que Chrome restaure la pestaña de /login y le muestre el formulario
// a alguien que ya está autenticado.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Construir un Request mínimo con los headers reales del request entrante
  // para que getToken pueda leer la cookie de sesión.
  const headersList = headers();
  const req = new Request('https://dummy.local', {
    headers: Object.fromEntries(headersList.entries()),
  });

  const token = await getToken({
    req: req as Parameters<typeof getToken>[0]['req'],
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: COOKIE_NAME,
    secureCookie: isSecure,
  });

  if (token) redirect('/dashboard');

  return <>{children}</>;
}
