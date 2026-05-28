import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions, User as NextAuthUser } from 'next-auth';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import { otpCodes, users } from '@/db/schema';
import { logger } from './logger';

const MAX_OTP_ATTEMPTS = 3;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'otp',
      name: 'OTP por WhatsApp',
      credentials: {
        phone: { label: 'Teléfono', type: 'text' },
        code: { label: 'Código', type: 'text' },
      },
      async authorize(credentials): Promise<NextAuthUser | null> {
        if (!credentials?.phone || !credentials.code) return null;

        const phone = credentials.phone.trim();
        const code = credentials.code.trim();

        const now = new Date();

        // Buscar OTP válido (no consumido, no expirado)
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
          .orderBy(otpCodes.created_at)
          .limit(1);

        if (!otp) {
          logger.warn({ phone }, 'otp not found or expired');
          return null;
        }

        const match = await bcrypt.compare(code, otp.code_hash);

        if (!match) {
          await db
            .update(otpCodes)
            .set({ attempts: otp.attempts + 1 })
            .where(eq(otpCodes.id, otp.id));
          logger.warn({ phone, attempts: otp.attempts + 1 }, 'otp mismatch');
          return null;
        }

        // Código correcto: marcar como consumido
        await db
          .update(otpCodes)
          .set({ consumed_at: now, attempts: otp.attempts + 1 })
          .where(eq(otpCodes.id, otp.id));

        // Buscar usuario activo
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
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 días
  },

  callbacks: {
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
