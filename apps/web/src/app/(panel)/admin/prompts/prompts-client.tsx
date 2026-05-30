'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const SLUG_LABELS: Record<string, string> = {
  'extract-report': 'Extracción de reporte',
  'classify-intent': 'Clasificación de intención',
  'assess-completeness': 'Evaluación de completitud',
  'followup-question': 'Pregunta de seguimiento',
  'consolidate-internal': 'Consolidado interno',
  'draft-social': 'Borrador redes sociales',
  'draft-newsletter': 'Borrador newsletter',
  'parse-absence': 'Parser de ausencias',
};

type ActivePrompt = {
  id: string;
  slug: string;
  version: number;
  model_hint: string;
  system_prompt: string;
  user_template: string;
  notes: string | null;
  author_name: string;
  created_at: string;
};

type VersionEntry = {
  id: string;
  slug: string;
  version: number;
  model_hint: string;
  system_prompt: string;
  user_template: string;
  notes: string | null;
  is_active: boolean;
  author_name: string;
  created_at: string;
};

interface Props {
  prompts: ActivePrompt[];
}

export function PromptsClient({ prompts: initialPrompts }: Props) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ system_prompt: '', user_template: '', model_hint: '', notes: '' });
  const [history, setHistory] = useState<Record<string, VersionEntry[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function toggleExpand(slug: string) {
    if (expanded === slug) {
      setExpanded(null);
      setEditing(null);
      return;
    }
    setExpanded(slug);
    setEditing(null);
    await loadHistory(slug);
  }

  async function loadHistory(slug: string) {
    if (history[slug]) return;
    setLoadingHistory(slug);
    try {
      const res = await fetch(`/api/admin/prompts/${slug}`);
      if (!res.ok) return;
      const data = await res.json() as { versions: VersionEntry[] };
      setHistory(h => ({ ...h, [slug]: data.versions }));
    } finally {
      setLoadingHistory(null);
    }
  }

  function startEdit(prompt: ActivePrompt) {
    setEditForm({
      system_prompt: prompt.system_prompt,
      user_template: prompt.user_template,
      model_hint: prompt.model_hint,
      notes: prompt.notes ?? '',
    });
    setEditing(prompt.slug);
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setError('');
  }

  async function handleSave(slug: string) {
    if (!editForm.system_prompt.trim() || !editForm.user_template.trim()) {
      setError('System prompt y user template son requeridos.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/prompts/${slug}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt: editForm.system_prompt.trim(),
          user_template: editForm.user_template.trim(),
          model_hint: editForm.model_hint.trim() || undefined,
          notes: editForm.notes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error: string };
        setError(data.error ?? 'Error al guardar');
        return;
      }

      // Actualizar lista local
      setPrompts(prev =>
        prev.map(p =>
          p.slug === slug
            ? {
                ...p,
                system_prompt: editForm.system_prompt.trim(),
                user_template: editForm.user_template.trim(),
                model_hint: editForm.model_hint.trim() || p.model_hint,
                notes: editForm.notes.trim() || null,
                version: p.version + 1,
                created_at: new Date().toISOString(),
                author_name: 'Vos',
              }
            : p,
        ),
      );
      // Limpiar historial para forzar recarga
      setHistory(h => { const n = { ...h }; delete n[slug]; return n; });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(slug: string, versionId: string, versionNum: number) {
    if (!confirm(`¿Activar la versión ${versionNum} del prompt "${SLUG_LABELS[slug] ?? slug}"?`)) return;

    const res = await fetch(`/api/admin/prompts/${slug}/activate/${versionId}`, {
      method: 'POST',
    });

    if (!res.ok) return;

    // Recargar historial
    setHistory(h => { const n = { ...h }; delete n[slug]; return n; });
    await loadHistory(slug);

    // Actualizar versión activa en la lista
    const updatedHistory = history[slug];
    if (updatedHistory) {
      const restored = updatedHistory.find(v => v.id === versionId);
      if (restored) {
        setPrompts(prev =>
          prev.map(p =>
            p.slug === slug
              ? {
                  ...p,
                  id: restored.id,
                  version: restored.version,
                  system_prompt: restored.system_prompt,
                  user_template: restored.user_template,
                  model_hint: restored.model_hint,
                  notes: restored.notes,
                  author_name: restored.author_name,
                  created_at: restored.created_at,
                }
              : p,
          ),
        );
      }
    }
  }

  const ALL_SLUGS = Object.keys(SLUG_LABELS);
  const presentSlugs = new Set(prompts.map(p => p.slug));
  const missingSlugs = ALL_SLUGS.filter(s => !presentSlugs.has(s));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Prompts de IA</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Editá los prompts que usa el sistema. Cada edición crea una versión nueva; podés restaurar versiones anteriores.
        </p>
      </div>

      {missingSlugs.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Sin seed:</strong> los siguientes prompts no tienen versión en la base de datos:{' '}
          {missingSlugs.map(s => SLUG_LABELS[s] ?? s).join(', ')}.
          Ejecutá <code className="font-mono bg-amber-100 px-1 rounded">pnpm db:seed-prompts</code> en el VPS para inicializar.
        </div>
      )}

      <div className="space-y-3">
        {prompts.map(prompt => (
          <Card key={prompt.slug} className="overflow-hidden">
            <button
              className="w-full text-left"
              onClick={() => toggleExpand(prompt.slug)}
            >
              <div className="px-5 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-zinc-800">
                      {SLUG_LABELS[prompt.slug] ?? prompt.slug}
                    </span>
                    <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded font-mono">
                      v{prompt.version}
                    </span>
                    <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">
                      {prompt.model_hint.replace('claude-', '').replace('-20251001', '')}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {prompt.author_name} · {new Date(prompt.created_at).toLocaleDateString('es-AR')}
                    {prompt.notes && <span className="ml-2 italic">{prompt.notes}</span>}
                  </p>
                </div>
                <span className="text-zinc-400 text-sm">{expanded === prompt.slug ? '▲' : '▼'}</span>
              </div>
            </button>

            {expanded === prompt.slug && (
              <CardContent className="border-t p-5 space-y-5">
                {editing === prompt.slug ? (
                  /* Formulario de edición */
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">
                        System prompt
                      </label>
                      <textarea
                        value={editForm.system_prompt}
                        onChange={e => setEditForm(f => ({ ...f, system_prompt: e.target.value }))}
                        rows={16}
                        className="w-full border rounded px-3 py-2 text-sm font-mono bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">
                        User template
                      </label>
                      <textarea
                        value={editForm.user_template}
                        onChange={e => setEditForm(f => ({ ...f, user_template: e.target.value }))}
                        rows={6}
                        className="w-full border rounded px-3 py-2 text-sm font-mono bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">Modelo</label>
                        <input
                          value={editForm.model_hint}
                          onChange={e => setEditForm(f => ({ ...f, model_hint: e.target.value }))}
                          className="w-full border rounded px-3 py-2 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">Notas</label>
                        <input
                          value={editForm.notes}
                          onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="Descripción del cambio (opcional)"
                          className="w-full border rounded px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-3">
                      <Button onClick={() => handleSave(prompt.slug)} disabled={saving}>
                        {saving ? 'Guardando…' : 'Guardar nueva versión'}
                      </Button>
                      <Button onClick={cancelEdit} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Vista de lectura */
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">System prompt</span>
                        <Button
                          onClick={() => startEdit(prompt)}
                          className="h-7 px-3 text-xs"
                        >
                          Editar
                        </Button>
                      </div>
                      <pre className="bg-zinc-50 border rounded p-3 text-xs font-mono whitespace-pre-wrap text-zinc-700 max-h-64 overflow-y-auto">
                        {prompt.system_prompt}
                      </pre>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide block mb-2">
                        User template
                      </span>
                      <pre className="bg-zinc-50 border rounded p-3 text-xs font-mono whitespace-pre-wrap text-zinc-700 max-h-32 overflow-y-auto">
                        {prompt.user_template}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Historial de versiones */}
                {editing !== prompt.slug && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-700 mb-3">Historial de versiones</h3>
                    {loadingHistory === prompt.slug ? (
                      <p className="text-xs text-zinc-400">Cargando…</p>
                    ) : history[prompt.slug] ? (
                      <div className="space-y-2">
                        {history[prompt.slug]
                          .slice()
                          .reverse()
                          .map(v => (
                            <div
                              key={v.id}
                              className={`flex items-center justify-between px-3 py-2 rounded border text-sm ${
                                v.is_active
                                  ? 'border-green-200 bg-green-50'
                                  : 'border-zinc-100 bg-zinc-50'
                              }`}
                            >
                              <div>
                                <span className="font-medium text-zinc-700">v{v.version}</span>
                                <span className="text-zinc-400 text-xs ml-3">
                                  {v.author_name} · {new Date(v.created_at).toLocaleDateString('es-AR')}
                                </span>
                                {v.notes && (
                                  <span className="text-zinc-400 text-xs ml-2 italic">{v.notes}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {v.is_active ? (
                                  <span className="text-xs text-green-600 font-medium">Activa</span>
                                ) : (
                                  <button
                                    onClick={() => handleActivate(prompt.slug, v.id, v.version)}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Restaurar
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">Cargando historial…</p>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
