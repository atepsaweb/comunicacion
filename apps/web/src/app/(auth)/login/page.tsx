'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Step = 'phone' | 'otp';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Error al enviar el código.');
        return;
      }
      setStep('otp');
    } catch {
      setError('Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('otp', {
        phone: phone.trim(),
        code: code.trim(),
        redirect: false,
      });
      if (result?.error) {
        setError('Código incorrecto o expirado. Volvé a solicitar uno.');
        setStep('phone');
        setCode('');
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError('Error de conexión. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm">
        {/* Encabezado */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-700 text-white text-xl font-bold mb-4">
            A
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">ATEPSA</h1>
          <p className="text-sm text-zinc-500 mt-1">Panel del Secretariado Nacional</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {step === 'phone' ? 'Ingresá tu número' : 'Ingresá el código'}
            </CardTitle>
            <CardDescription>
              {step === 'phone'
                ? 'Te enviaremos un código por WhatsApp.'
                : `Código enviado al ${phone}. Válido por 5 minutos.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'phone' ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Número de WhatsApp</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+5491145678901"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    required
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Enviando…' : 'Enviar código'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Código de 6 dígitos</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Verificando…' : 'Ingresar'}
                </Button>
                <button
                  type="button"
                  className="w-full text-sm text-zinc-500 hover:text-zinc-700 underline"
                  onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                >
                  Usar otro número
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
