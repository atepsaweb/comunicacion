// Extensión de tipos de NextAuth para que TypeScript conozca los campos personalizados
// que agregamos al objeto de sesión y al token JWT.
// Sin este archivo, TypeScript no sabría que session.user tiene 'role', 'phone_e164', etc.
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  // Agrega los campos extra al tipo Session de NextAuth
  interface Session {
    user: {
      id: string;
      // Número de teléfono en formato E.164 (ej: +5491145678901)
      phone_e164: string;
      // Rol del usuario en el sistema
      role: 'secretary' | 'executive' | 'press_admin';
      full_name: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  // Agrega los mismos campos al token JWT que viaja en la cookie de sesión
  interface JWT {
    id: string;
    phone_e164: string;
    role: string;
    full_name: string;
  }
}
