'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type MentionEntry = {
  term: string;
  frequency: number;
  alreadyInPrompt: boolean;
};

interface Props {
  mentions: MentionEntry[];
}

type ApplyResponse = { ok: boolean; newVersion: number; termsAdded: string[] };

export function GlosarioClient({ mentions: initialMentions }: Props) {
  const router = useRouter();
  const [mentions] = useState(initialMentions);
  const [hideIncluded, setHideIncluded] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');

  const filtered = useMemo(() => {
    return mentions.filter(m => {
      if (hideIncluded && m.alreadyInPrompt) return false;
      if (search && !m.term.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [mentions, hideIncluded, search]);

  function toggleSelect(term: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(term)) {
        next.delete(term);
      } else {
        next.add(term);
      }
      return next;
    });
  }

  async function handleApply() {
    if (selected.size === 0) return;
    setStatus('saving');
    setFeedback('');
    try {
      const res = await fetch('/api/admin/glosario/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setFeedback(data.error ?? 'Error al aplicar');
        setStatus('error');
        return;
      }
      const data = await res.json() as ApplyResponse;
      setFeedback(`Versión ${data.newVersion} creada. Términos agregados: ${data.termsAdded.join(', ')}.`);
      setStatus('done');
      setSelected(new Set());
      router.refresh();
    } catch {
      setFeedback('Error de red al aplicar');
      setStatus('error');
    }
  }

  const includedCount = mentions.filter(m => m.alreadyInPrompt).length;
  const pendingCount = mentions.filter(m => !m.alreadyInPrompt).length;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Glosario de términos</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Términos detectados en reportes de los últimos 90 días. Marcá los que querés que la IA reconozca mejor y aplicá al prompt de extracción.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>{mentions.length} términos · {includedCount} ya en prompt · {pendingCount} pendientes</span>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="py-4 flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              checked={hideIncluded}
              onChange={e => setHideIncluded(e.target.checked)}
              className="rounded"
            />
            Ocultar los que ya están en el prompt
          </label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar término…"
            className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400 py-6 text-center">
              No hay términos que mostrar con los filtros actuales.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left w-8"></th>
                  <th className="px-4 py-3 text-left">Término</th>
                  <th className="px-4 py-3 text-right">Frecuencia</th>
                  <th className="px-4 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map(m => (
                  <tr
                    key={m.term}
                    className={m.alreadyInPrompt ? 'bg-zinc-50 opacity-60' : 'hover:bg-zinc-50 cursor-pointer'}
                    onClick={() => !m.alreadyInPrompt && toggleSelect(m.term)}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(m.term)}
                        disabled={m.alreadyInPrompt}
                        onChange={() => toggleSelect(m.term)}
                        onClick={e => e.stopPropagation()}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-800">{m.term}</td>
                    <td className="px-4 py-3 text-right text-zinc-500">{m.frequency} {m.frequency === 1 ? 'vez' : 'veces'}</td>
                    <td className="px-4 py-3 text-right">
                      {m.alreadyInPrompt && (
                        <span className="inline-block text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          Ya incluido
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Acción */}
      {selected.size > 0 && (
        <div className="flex items-center gap-4">
          <Button
            onClick={handleApply}
            disabled={status === 'saving'}
          >
            {status === 'saving'
              ? 'Guardando…'
              : `Aplicar al prompt de extracción (${selected.size})`}
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-zinc-400 hover:text-zinc-600"
          >
            Desseleccionar todo
          </button>
        </div>
      )}

      {feedback && (
        <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {feedback}
        </p>
      )}
    </div>
  );
}
