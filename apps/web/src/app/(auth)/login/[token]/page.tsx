'use client';

// Login automático por link personal. Cuando un integrante del Secretariado
// abre /login/<token>, este componente llama a signIn con el provider
// "access-token" usando el token de la URL. Si es válido, NextAuth setea la
// cookie de sesión y redirigimos al dashboard.
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

type Status = 'pending' | 'error';

export default function LoginWithTokenPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await signIn('access-token', {
          token: params.token,
          redirect: false,
        });
        if (cancelled) return;
        if (result?.error) {
          setStatus('error');
          return;
        }
        router.replace('/dashboard');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-700 text-white text-xl font-bold mb-4">
            A
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">ATEPSA</h1>
          <p className="text-sm text-zinc-500 mt-1">Panel del Secretariado Nacional</p>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          {status === 'pending' ? (
            <>
              <h2 className="text-base font-semibold text-zinc-900">Ingresando…</h2>
              <p className="mt-2 text-sm text-zinc-600">Verificando tu link de acceso.</p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-zinc-900">Link no válido</h2>
              <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                Este link de acceso no es válido o ya expiró. Pedile uno nuevo a{' '}
                <strong className="text-zinc-900">Julián Gaday</strong> por WhatsApp.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
