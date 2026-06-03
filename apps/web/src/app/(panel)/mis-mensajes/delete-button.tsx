'use client';

// Botón inline para que el secretario elimine un mensaje propio de la lista.
// Hace DELETE /api/messages/[id] y refresca el server component.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  messageId: string;
}

export function DeleteMessageButton({ messageId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function handleDelete() {
    if (!confirm('Eliminar este mensaje? No se va a contar para el reporte y no aparecerá más en esta lista.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('No se pudo eliminar el mensaje.');
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      {busy ? 'Eliminando…' : 'Eliminar'}
    </button>
  );
}
