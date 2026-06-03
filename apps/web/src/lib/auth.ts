// Configuración completa del sistema de autenticación del panel web.
// Usamos NextAuth.js con un proveedor personalizado de OTP por WhatsApp:
// no hay contraseñas, solo códigos de 6 dígitos enviados al celular del usuario.
// Las sesiones se guardan en cookies JWT (firmadas, no en base de datos).
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions, User as NextAuthUser } from 'next-auth';
import bcrypt from 'bcryptjs';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import { otpCodes, users } from '@/db/schema';
import { validateAccessToken } from './access-tokens';
import { logger } from './logger';
import { normalizeArgPhone } from './utils';

// Máximo de intentos antes de bloquear un código OTP (protección anti-fuerza bruta)
const MAX_OTP_ATTEMPTS = 3;

// En producción (HTTPS) las cookies requieren el prefijo __Secure-
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
// La sesión dura 30 días; si el usuario no accede en ese tiempo, tiene que loguearse de nuevo
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 días en segundos

export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: `${useSecureCookies ? '__Secure-' : ''}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: useSecureCookies,
        maxAge: SESSION_MAX_AGE,
      },
    },
  },
  providers: [
    CredentialsProvider({
      id: 'otp',
      name: 'OTP por WhatsApp',
      credentials: {
        phone: { label: 'Teléfono', type: 'text' },
        code: { label: 'Código', type: 'text' },
      },
      // Esta función se llama cuando el usuario envía el formulario de login con su código OTP.
      // Devuelve el objeto de usuario si el código es válido, o null si hay algún problema.
      async authorize(credentials): Promise<NextAuthUser | null> {
        if (!credentials?.phone || !credentials.code) return null;

        // Normalizar el número de teléfono al formato estándar argentino (+549...)
        const phone = normalizeArgPhone(credentials.phone.trim());
        if (!phone) return null;
        const code = credentials.code.trim();

        const now = new Date();

        // Buscar el OTP más reciente que sea válido para este teléfono:
        // que no haya sido ya consumido, que no esté expirado, y que no tenga demasiados intentos fallidos
        const [otp] = await db
          .select()
          .from(otpCodes)
          .where(
            and(
              eq(otpCodes.phone_e164, phone),
              isNull(otpCodes.consumed_at),
              gt(otpCodes.expires_at, now),
              lt(otpCodes.attempts, MAX_OTP_ATTEMPTS),
            ),
          )
          .orderBy(desc(otpCodes.created_at))
          .limit(1);

        if (!otp) {
          logger.warn({ phone }, 'otp not found or expired');
          return null;
        }

        // Comparar el código ingresado con el hash guardado en la base de datos
        const match = await bcrypt.compare(code, otp.code_hash);

        if (!match) {
          // Incrementar el contador de intentos fallidos
          await db
            .update(otpCodes)
            .set({ attempts: otp.attempts + 1 })
            .where(eq(otpCodes.id, otp.id));
          logger.warn({ phone, attempts: otp.attempts + 1 }, 'otp mismatch');
          return null;
        }

        // Código correcto: marcar como consumido para que no pueda reutilizarse
        await db
          .update(otpCodes)
          .set({ consumed_at: now, attempts: otp.attempts + 1 })
          .where(eq(otpCodes.id, otp.id));

        // Buscar el usuario en la base de datos y verificar que esté activo
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, otp.user_id), eq(users.is_active, true)))
          .limit(1);

        if (!user) {
          logger.warn({ userId: otp.user_id }, 'user not found or inactive');
          return null;
        }

        logger.info({ userId: user.id, phone }, 'otp login successful');

        return {
          id: user.id,
          name: user.full_name,
          email: user.email ?? undefined,
          phone_e164: user.phone_e164,
          role: user.role,
          full_name: user.full_name,
        } as NextAuthUser & { phone_e164: string; role: string; full_name: string };
      },
    }),
    CredentialsProvider({
      id: 'access-token',
      name: 'Link personal',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      // Login por link personal: el secretario abre /login/<token> y este
      // provider valida el token contra app.access_tokens.
      async authorize(credentials): Promise<NextAuthUser | null> {
        if (!credentials?.token) return null;
        const validation = await validateAccessToken(credentials.token.trim());
        if (!validation) {
          logger.warn('access-token: token invalido o expirado');
          return null;
        }
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, validation.userId), eq(users.is_active, true)))
          .limit(1);
        if (!user) {
          logger.warn({ userId: validation.userId }, 'access-token: user inactive or missing');
          return null;
        }
        logger.info({ userId: user.id }, 'access-token login successful');
        return {
          id: user.id,
          name: user.full_name,
          email: user.email ?? undefined,
          phone_e164: user.phone_e164,
          role: user.role,
          full_name: user.full_name,
        } as NextAuthUser & { phone_e164: string; role: string; full_name: string };
      },
    }),
  ],

  session: {
    // Las sesiones se guardan en tokens JWT en cookies, no en base de datos.
    // Esto hace el sistema más simple y sin estado adicional del lado del servidor.
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
    // Renovar el token si la sesión tiene más de 24 horas (para mantenerla fresca)
    updateAge: 24 * 60 * 60,
  },

  callbacks: {
    // Cuando se crea o renueva el token JWT, agregamos los datos del usuario
    // que el cliente necesita (rol, teléfono, nombre completo)
    jwt({ token, user }) {
      if (user) {
        const u = user as NextAuthUser & { phone_e164: string; role: string; full_name: string };
        token.id = u.id;
        token.phone_e164 = u.phone_e164;
        token.role = u.role;
        token.full_name = u.full_name;
      }
      return token;
    },
    // Cuando el cliente pide la sesión, copiamos los datos del token al objeto de sesión
    // para que estén disponibles en el frontend con useSession() o getServerSession()
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.phone_e164 = token.phone_e164 as string;
      session.user.role = token.role as 'secretary' | 'executive' | 'press_admin';
      session.user.full_name = token.full_name as string;
      return session;
    },
  },

  pages: {
    signIn: '/login',
  },

  secret: process.env.NEXTAUTH_SECRET,
};
