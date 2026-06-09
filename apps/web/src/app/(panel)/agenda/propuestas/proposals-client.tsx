'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

type Proposal = {
  id: string;
  title: string;
  type: string;
  starts_at: string;
  starts_at_label: string;
  all_day: boolean;
  location: string | null;
  description_md: string | null;
  created_at: string;
  creator_name: string;
};

interface Props {
  proposals: Proposal[];
  canApprove: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  secretariat:  'Secretariado',
  mobilization: 'Movilización',
};

const TYPE_COLOR: Record<string, string> = {
  secretariat:  'bg-blue-100 text-blue-700',
  mobilization: 'bg-red-100 text-red-700',
};

export function ProposalsClient({ proposals: initial, canApprove }: Props) {
  const router = useRouter();
  const [proposals, setProposals] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function handleApprove(id: string) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/agenda/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Error al aprobar.');
        return;
      }
      setProposals(prev => prev.filter(p => p.id !== id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(id: string) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/agenda/events/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Error al rechazar.');
        return;
      }
      setProposals(prev => prev.filter(p => p.id !== id));
      setRejectTarget(null);
      setReason('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (proposals.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm text-zinc-500">No hay propuestas pendientes. ✅</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
      )}

      {proposals.map(p => (
        <div key={p.id} className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[p.type] ?? 'bg-zinc-100 text-zinc-600'}`}>
                  {TYPE_LABEL[p.type] ?? p.type}
                </span>
                <span className="text-xs text-zinc-400">por {p.creator_name}</span>
              </div>
              <Link href={`/agenda/${p.id}`} className="font-semibold text-zinc-900 hover:text-[#2E3863] transition-colors">
                {p.title}
              </Link>
              <p className="text-sm text-zinc-500 mt-0.5">📅 {p.starts_at_label}</p>
              {p.location && <p className="text-sm text-zinc-500">📍 {p.location}</p>}
              {p.description_md && (
                <p className="text-sm text-zinc-600 mt-1 line-clamp-2">{p.description_md}</p>
              )}
            </div>
          </div>

          {/* Acciones */}
          {canApprove && (
            <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50">
              {rejectTarget === p.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Motivo del rechazo (opcional)"
                    maxLength={200}
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy === p.id}
                      onClick={() => handleReject(p.id)}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      {busy === p.id ? 'Rechazando...' : 'Confirmar rechazo'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === p.id}
                      onClick={() => { setRejectTarget(null); setReason(''); setError(''); }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => handleApprove(p.id)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {busy === p.id ? 'Aprobando...' : '✅ Aprobar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === p.id}
                    onClick={() => { setRejectTarget(p.id); setError(''); }}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    ❌ Rechazar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
