import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      phone_e164: string;
      role: 'secretary' | 'executive' | 'press_admin';
      full_name: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    phone_e164: string;
    role: string;
    full_name: string;
  }
}
