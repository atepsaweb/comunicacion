'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Props {
  eventId: string;
  canEdit: boolean;
  canCancel: boolean;
}

export function EventActions({ eventId, canEdit, canCancel }: Props) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function handleCancel() {
    setCancelling(true);
    setError('');
    try {
      const res = await fetch(`/api/agenda/events/${eventId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Error al cancelar.');
        return;
      }
      router.refresh();
      setShowConfirm(false);
    } finally {
      setCancelling(false);
    }
  }

  if (!canEdit && !canCancel) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/agenda/${eventId}/editar`)}
          >
            Editar
          </Button>
        )}
        {canCancel && !showConfirm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfirm(true)}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            Cancelar evento
          </Button>
        )}
      </div>

      {showConfirm && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800">¿Cancelar este evento?</p>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Motivo (opcional)"
            maxLength={200}
            className="w-full rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelling ? 'Cancelando...' : 'Sí, cancelar'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setShowConfirm(false); setReason(''); setError(''); }}
              disabled={cancelling}
            >
              Volver
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
