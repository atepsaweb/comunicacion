'use client';

import { useState } from 'react';

export type AttendeeRow = {
  id: string;
  user_id: string;
  status: string;
  responded_at: string | null;
  response_source: string | null;
  full_name: string | null;
  role: string | null;
  position: string | null;
};

interface Props {
  eventId: string;
  attendees: AttendeeRow[];
  currentUserId: string;
  canMarkOwn: boolean; // puede marcar su propia asistencia desde el panel
}

const STATUS_LABEL: Record<string, string> = {
  invited:     'Sin responder',
  going:       'Asiste',
  not_going:   'No asiste',
  maybe:       'Tal vez',
  no_response: 'Sin respuesta',
  on_leave:    'De licencia',
};

const STATUS_COLOR: Record<string, string> = {
  invited:     'bg-zinc-100 text-zinc-500',
  going:       'bg-green-100 text-green-700',
  not_going:   'bg-red-100 text-red-700',
  maybe:       'bg-amber-100 text-amber-700',
  no_response: 'bg-zinc-100 text-zinc-500',
  on_leave:    'bg-zinc-200 text-zinc-400',
};

const ROLE_LABEL: Record<string, string> = {
  secretary:  'Secretaría',
  executive:  'Ejecutiva',
  press_admin: 'Prensa',
};

const ART_TZ = 'America/Argentina/Buenos_Aires';

function formatART(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: ART_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AttendeesBoard({ eventId, attendees: initial, currentUserId, canMarkOwn }: Props) {
  const [attendees, setAttendees] = useState<AttendeeRow[]>(initial);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const myAttendee = attendees.find(a => a.user_id === currentUserId);

  async function handleMarkOwn(status: 'going' | 'not_going' | 'maybe') {
    if (!myAttendee) return;
    setLoadingId(myAttendee.id);
    setError('');
    try {
      const res = await fetch(`/api/agenda/events/${eventId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Error al actualizar.');
        return;
      }
      setAttendees(prev =>
        prev.map(a =>
          a.user_id === currentUserId
            ? { ...a, status, responded_at: new Date().toISOString(), response_source: 'panel' }
            : a,
        ),
      );
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/agenda/events/${eventId}/attendees?format=xlsx`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asistencia-${eventId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  // Agrupados por estado para el resumen
  const going     = attendees.filter(a => a.status === 'going').length;
  const notGoing  = attendees.filter(a => a.status === 'not_going').length;
  const maybe     = attendees.filter(a => a.status === 'maybe').length;
  const pending   = attendees.filter(a => a.status === 'invited').length;
  const onLeave   = attendees.filter(a => a.status === 'on_leave').length;

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-green-700">
          <span className="font-semibold">{going}</span> asisten
        </span>
        <span className="text-zinc-300">·</span>
        <span className="flex items-center gap-1.5 text-red-600">
          <span className="font-semibold">{notGoing}</span> no pueden
        </span>
        <span className="text-zinc-300">·</span>
        <span className="flex items-center gap-1.5 text-amber-600">
          <span className="font-semibold">{maybe}</span> tal vez
        </span>
        <span className="text-zinc-300">·</span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <span className="font-semibold">{pending}</span> sin responder
        </span>
        {onLeave > 0 && (
          <>
            <span className="text-zinc-300">·</span>
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="font-semibold">{onLeave}</span> de licencia
            </span>
          </>
        )}
      </div>

      {/* Mi asistencia */}
      {canMarkOwn && myAttendee && myAttendee.status !== 'on_leave' && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Tu asistencia</p>
          <div className="flex gap-2 flex-wrap">
            {(['going', 'not_going', 'maybe'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleMarkOwn(s)}
                disabled={loadingId === myAttendee.id}
                className={
                  `px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ` +
                  (myAttendee.status === s
                    ? 'bg-[#2E3863] text-white border-[#2E3863]'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400')
                }
              >
                {s === 'going' ? '✅ Voy' : s === 'not_going' ? '❌ No puedo' : '🤔 Tal vez'}
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* Tabla de convocados */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Nombre</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide hidden sm:table-cell">Cargo</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Estado</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide hidden md:table-cell">Respondió</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {attendees.map(a => (
              <tr key={a.id} className={a.user_id === currentUserId ? 'bg-blue-50/40' : ''}>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-zinc-800">{a.full_name ?? '—'}</span>
                  {a.user_id === currentUserId && (
                    <span className="ml-1.5 text-xs text-zinc-400">(vos)</span>
                  )}
                </td>
                <td className="px-4 py-2.5 hidden sm:table-cell text-zinc-500 text-xs">
                  {a.position ?? ROLE_LABEL[a.role ?? ''] ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status] ?? 'bg-zinc-100 text-zinc-500'}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell text-zinc-400 text-xs">
                  {a.responded_at ? formatART(a.responded_at) : '—'}
                  {a.response_source && a.responded_at && (
                    <span className="ml-1 text-zinc-300">({a.response_source})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Exportar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors underline underline-offset-2"
        >
          {downloading ? 'Descargando...' : 'Exportar .xlsx'}
        </button>
      </div>
    </div>
  );
}
