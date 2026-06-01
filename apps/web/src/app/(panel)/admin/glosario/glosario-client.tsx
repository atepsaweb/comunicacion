'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type MentionEntry = {
  term: string;
  frequency: number;
  alreadyInPrompt: boolean;
  description: string;
};

interface Props {
  mentions: MentionEntry[];
}

type ApplyResponse = { ok: boolean; newVersion: number; termsAdded: string[] };
type DescriptionResponse = { ok: boolean; term: string; description: string };

export function GlosarioClient({ mentions: initialMentions }: Props) {
  const router = useRouter();

  const [mentions, setMentions] = useState(initialMentions);
  const [hideIncluded, setHideIncluded] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyStatus, setApplyStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [applyFeedback, setApplyFeedback] = useState('');

  // Edición de descripciones
  const [editingTerm, setEditingTerm] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingDesc, setSavingDesc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Archivado
  const [archivingTerm, setArchivingTerm] = useState<string | null>(null);

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
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  // ─── Descripción ────────────────────────────────────────────────────────────

  function startEditDesc(term: string, current: string) {
    setEditingTerm(term);
    setEditingValue(current);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commitDesc(term: string) {
    const trimmed = editingValue.trim();
    const original = mentions.find(m => m.term === term)?.description ?? '';
    setEditingTerm(null);
    if (trimmed === original) return;

    setSavingDesc(term);
    try {
      const res = await fetch('/api/admin/glosario/descriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, description: trimmed }),
      });
      if (res.ok) {
        const data = await res.json() as DescriptionResponse;
        setMentions(prev =>
          prev.map(m => m.term === term ? { ...m, description: data.description } : m),
        );
      }
    } finally {
      setSavingDesc(null);
    }
  }

  function handleDescKeyDown(e: React.KeyboardEvent, term: string) {
    if (e.key === 'Enter') { e.preventDefault(); void commitDesc(term); }
    if (e.key === 'Escape') setEditingTerm(null);
  }

  // ─── Archivado ───────────────────────────────────────────────────────────────

  async function handleArchive(term: string) {
    setArchivingTerm(term);
    try {
      const res = await fetch('/api/admin/glosario/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, archived: true }),
      });
      if (res.ok) {
        // Quitar de la lista local — no volverá a aparecer
        setMentions(prev => prev.filter(m => m.term !== term));
        setSelected(prev => { const next = new Set(prev); next.delete(term); return next; });
      }
    } finally {
      setArchivingTerm(null);
    }
  }

  // ─── Aplicar al prompt ───────────────────────────────────────────────────────

  async function handleApply() {
    if (selected.size === 0) return;
    setApplyStatus('saving');
    setApplyFeedback('');
    try {
      const res = await fetch('/api/admin/glosario/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setApplyFeedback(data.error ?? 'Error al aplicar');
        setApplyStatus('error');
        return;
      }
      const data = await res.json() as ApplyResponse;
      setApplyFeedback(`Versión ${data.newVersion} creada. Términos agregados: ${data.termsAdded.join(', ')}.`);
      setApplyStatus('done');
      setSelected(new Set());
      router.refresh();
    } catch {
      setApplyFeedback('Error de red al aplicar');
      setApplyStatus('error');
    }
  }

  const includedCount = mentions.filter(m => m.alreadyInPrompt).length;
  const pendingCount  = mentions.filter(m => !m.alreadyInPrompt).length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Glosario de términos</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Términos detectados en reportes de los últimos 90 días. Seleccioná los técnicos o siglas que la IA deba conocer mejor y aplicálos al prompt. Los irrelevantes podés archivarlos para que no vuelvan a aparecer.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>{mentions.length} términos · {includedCount} ya en prompt · {pendingCount} pendientes</span>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="py-4 flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer shrink-0">
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

      {/* Mobile: cards apiladas */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-zinc-400">
              No hay términos que mostrar con los filtros actuales.
            </CardContent>
          </Card>
        ) : (
          filtered.map(m => (
            <Card key={m.term} className={m.alreadyInPrompt ? 'opacity-60' : ''}>
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(m.term)}
                    disabled={m.alreadyInPrompt}
                    onChange={() => toggleSelect(m.term)}
                    className="rounded mt-0.5 cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-800 text-sm">{m.term}</span>
                      <span className="text-xs text-zinc-500 tabular-nums shrink-0">{m.frequency}×</span>
                    </div>
                    {editingTerm === m.term ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editingValue}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={() => void commitDesc(m.term)}
                        onKeyDown={e => handleDescKeyDown(e, m.term)}
                        maxLength={120}
                        placeholder="Descripción breve…"
                        className="mt-1 w-full border border-zinc-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400"
                      />
                    ) : (
                      <button
                        onClick={() => startEditDesc(m.term, m.description)}
                        className="mt-1 text-left block w-full"
                      >
                        {savingDesc === m.term ? (
                          <span className="text-zinc-400 italic text-xs">Guardando…</span>
                        ) : m.description ? (
                          <span className="text-zinc-600 text-xs">{m.description}</span>
                        ) : (
                          <span className="text-zinc-400 italic text-xs">+ agregar descripción</span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {m.alreadyInPrompt ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      En prompt
                    </span>
                  ) : archivingTerm === m.term ? (
                    <span className="text-xs text-zinc-300">Archivando…</span>
                  ) : (
                    <button
                      onClick={() => handleArchive(m.term)}
                      className="text-xs text-zinc-400 hover:text-red-500 underline underline-offset-2"
                    >
                      Archivar
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Desktop: tabla */}
      <Card className="hidden md:block">
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
                  <th className="px-4 py-3 text-left w-36">Término</th>
                  <th className="px-4 py-3 text-left">Descripción breve</th>
                  <th className="px-4 py-3 text-right w-24">Frec.</th>
                  <th className="px-4 py-3 text-right w-32">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map(m => (
                  <tr
                    key={m.term}
                    className={`group ${m.alreadyInPrompt ? 'bg-zinc-50 opacity-60' : 'hover:bg-zinc-50'}`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(m.term)}
                        disabled={m.alreadyInPrompt}
                        onChange={() => toggleSelect(m.term)}
                        className="rounded cursor-pointer"
                      />
                    </td>

                    {/* Término */}
                    <td
                      className="px-4 py-3 font-medium text-zinc-800 cursor-pointer select-none"
                      onClick={() => !m.alreadyInPrompt && toggleSelect(m.term)}
                    >
                      {m.term}
                    </td>

                    {/* Descripción editable */}
                    <td className="px-4 py-3">
                      {editingTerm === m.term ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => void commitDesc(m.term)}
                          onKeyDown={e => handleDescKeyDown(e, m.term)}
                          maxLength={120}
                          placeholder="Descripción breve (máx. 120 car.)…"
                          className="w-full border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        />
                      ) : (
                        <button
                          onClick={() => startEditDesc(m.term, m.description)}
                          className="w-full text-left group/desc"
                          title="Clic para editar"
                        >
                          {savingDesc === m.term ? (
                            <span className="text-zinc-400 italic text-xs">Guardando…</span>
                          ) : m.description ? (
                            <span className="text-zinc-600 group-hover/desc:text-zinc-900 transition-colors">
                              {m.description}
                            </span>
                          ) : (
                            <span className="text-zinc-300 group-hover/desc:text-zinc-400 italic transition-colors text-xs">
                              + agregar descripción
                            </span>
                          )}
                        </button>
                      )}
                    </td>

                    {/* Frecuencia */}
                    <td className="px-4 py-3 text-right text-zinc-500 tabular-nums">
                      {m.frequency}×
                    </td>

                    {/* Estado / Acciones */}
                    <td className="px-4 py-3 text-right">
                      {m.alreadyInPrompt ? (
                        <span className="inline-block text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          En prompt
                        </span>
                      ) : archivingTerm === m.term ? (
                        <span className="text-xs text-zinc-300">Archivando…</span>
                      ) : (
                        <button
                          onClick={() => handleArchive(m.term)}
                          title="Archivar — no vuelve a aparecer como sugerencia"
                          className="text-xs text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          Archivar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Acción aplicar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-4">
          <Button
            onClick={handleApply}
            disabled={applyStatus === 'saving'}
          >
            {applyStatus === 'saving'
              ? 'Guardando…'
              : `Aplicar al prompt de extracción (${selected.size})`}
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-zinc-400 hover:text-zinc-600"
          >
            Deseleccionar todo
          </button>
        </div>
      )}

      {applyFeedback && (
        <p className={`text-sm ${applyStatus === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {applyFeedback}
        </p>
      )}
    </div>
  );
}
