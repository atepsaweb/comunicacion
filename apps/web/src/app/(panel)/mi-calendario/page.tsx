'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Token = {
  id: string;
  scope: 'all' | 'secretariat' | 'personal';
  token: string;
  last_accessed_at: string | null;
  created_at: string;
};

const SCOPE_INFO: Record<string, { label: string; description: string }> = {
  all: {
    label: 'Todos los eventos',
    description: 'Eventos personales tuyos + todos los eventos del Secretariado confirmados.',
  },
  secretariat: {
    label: 'Solo Secretariado',
    description: 'Eventos del Secretariado y movilizaciones confirmadas, sin los personales.',
  },
  personal: {
    label: 'Solo personales',
    description: 'Solo tus eventos personales.',
  },
};

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Forzar HTTPS: Apple Calendar y otros clientes rechazan suscripciones HTTP.
    // Si el usuario llegó al panel por HTTP (sin redirect), la URL generada igual
    // debe ser HTTPS para que la suscripción funcione.
    return window.location.origin.replace(/^http:\/\//, 'https://');
  }
  return '';
}

export default function MiCalendarioPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/agenda/ical-tokens')
      .then(r => r.json())
      .then((d: { tokens: Token[] }) => setTokens(d.tokens))
      .finally(() => setLoading(false));
  }, []);

  function getToken(scope: string): Token | undefined {
    return tokens.find(t => t.scope === scope);
  }

  async function handleGenerate(scope: string) {
    setBusy(scope);
    try {
      const res = await fetch('/api/agenda/ical-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const d = await res.json() as { token: Token };
      setTokens(prev => {
        const without = prev.filter(t => t.scope !== scope);
        return [...without, d.token];
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleRevoke(tokenId: string, scope: string) {
    setBusy(scope);
    try {
      await fetch(`/api/agenda/ical-tokens/${tokenId}/revoke`, { method: 'POST' });
      setTokens(prev => prev.filter(t => t.id !== tokenId));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const base = getBaseUrl();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Mi calendario</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Suscribí tu aplicación de calendario (Google, Apple, Outlook) para ver los eventos de ATEPSA actualizados automáticamente.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm text-amber-700">
          <span className="font-medium">¿Cómo suscribirse?</span> Copiá la URL y pegala en tu app como &ldquo;Suscribirse a calendario&rdquo; (Google: Otros calendarios → Desde URL). El feed se actualiza cada 15 minutos.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-400">Cargando...</div>
      ) : (
        <div className="space-y-4">
          {(['all', 'secretariat', 'personal'] as const).map(scope => {
            const tok = getToken(scope);
            const feedUrl = tok ? `${base}/api/ical/${tok.token}` : null;
            const info = SCOPE_INFO[scope]!;
            const isBusy = busy === scope;

            return (
              <div key={scope} className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-100">
                  <p className="font-medium text-zinc-900 text-sm">{info.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{info.description}</p>
                </div>
                <div className="px-4 py-3">
                  {tok && feedUrl ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <input
                          readOnly
                          value={feedUrl}
                          className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-mono text-zinc-700 focus:outline-none"
                          onFocus={e => e.target.select()}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopy(feedUrl, scope)}
                          className="shrink-0 text-xs"
                        >
                          {copied === scope ? '✓ Copiado' : 'Copiar'}
                        </Button>
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>
                          Generado el {formatDate(tok.created_at)}
                          {tok.last_accessed_at && ` · Último acceso: ${formatDate(tok.last_accessed_at)}`}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleGenerate(scope)}
                            className="text-zinc-400 hover:text-zinc-700 underline underline-offset-2"
                          >
                            {isBusy ? '...' : 'Regenerar'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRevoke(tok.id, scope)}
                            className="text-red-400 hover:text-red-600 underline underline-offset-2"
                          >
                            {isBusy ? '...' : 'Revocar'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => handleGenerate(scope)}
                    >
                      {isBusy ? 'Generando...' : 'Generar URL de suscripción'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
