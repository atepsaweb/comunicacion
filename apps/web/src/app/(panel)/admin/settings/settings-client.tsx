'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';

type Setting = {
  key: string;
  value: unknown;
  updatedAt: string;
};

interface Props {
  settings: Setting[];
}

export function SettingsClient({ settings: initialSettings }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function startEdit(s: Setting) {
    setEditingKey(s.key);
    setEditText(JSON.stringify(s.value, null, 2));
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setError(null);
  }

  async function handleSave(key: string) {
    setError(null);
    setSuccess(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      setError('JSON inválido. Revisá la sintaxis antes de guardar.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parsed }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Error al guardar.');
        return;
      }
      setSettings(prev =>
        prev.map(s =>
          s.key === key ? { ...s, value: parsed, updatedAt: new Date().toISOString() } : s,
        ),
      );
      setEditingKey(null);
      setSuccess(`"${key}" guardado correctamente.`);
    } catch {
      setError('Error de red al guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Configuración del sistema</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Parámetros globales del sistema. Los valores se guardan como JSON.
        </p>
      </div>

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      {settings.map(setting => (
        <Card key={setting.key}>
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-mono text-sm font-semibold text-zinc-900">{setting.key}</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Actualizado: {new Date(setting.updatedAt).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
              {editingKey !== setting.key && (
                <button
                  onClick={() => startEdit(setting)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2 shrink-0"
                >
                  Editar
                </button>
              )}
            </div>

            {editingKey === setting.key ? (
              <div className="space-y-3">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={Math.min(20, editText.split('\n').length + 2)}
                  spellCheck={false}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-800 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
                {error && (
                  <p className="text-xs text-red-600">{error}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSave(setting.key)}
                    disabled={saving}
                    className="px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-1.5 text-zinc-500 text-xs hover:text-zinc-800 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <pre className="text-xs text-zinc-600 font-mono bg-zinc-50 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                {JSON.stringify(setting.value, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
