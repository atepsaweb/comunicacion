'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Absence = {
  id: string;
  user_id: string;
  user_name: string;
  user_position: string | null;
  type: 'scheduled_leave' | 'weekly_pause';
  starts_on: string;
  ends_on: string;
  reason: string | null;
  source: string;
  created_at: string;
};

type User = {
  id: string;
  full_name: string;
  position: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  scheduled_leave: 'Vacaciones / Licencia',
  weekly_pause: 'Pausa semanal',
};

const SOURCE_LABELS: Record<string, string> = {
  panel: 'Panel',
  admin: 'Admin',
  whatsapp: 'WhatsApp',
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  return monday.toISOString().split('T')[0]!;
}

function getWeekSunday(): string {
  const monday = getWeekMonday();
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split('T')[0]!;
}

interface Props {
  initialAbsences: Absence[];
  users: User[];
}

export function AdminAusenciasClient({ initialAbsences, users }: Props) {
  const [absences, setAbsences] = useState<Absence[]>(initialAbsences);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filterUser, setFilterUser] = useState('');

  const [form, setForm] = useState({
    user_id: '',
    type: 'scheduled_leave' as 'scheduled_leave' | 'weekly_pause',
    starts_on: '',
    ends_on: '',
    reason: '',
  });

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/absences');
    const data = await res.json();
    setAbsences(data.absences ?? []);
  }, []);

  function handleTypeChange(type: 'scheduled_leave' | 'weekly_pause') {
    if (type === 'weekly_pause') {
      setForm(f => ({ ...f, type, starts_on: getWeekMonday(), ends_on: getWeekSunday() }));
    } else {
      setForm(f => ({ ...f, type, starts_on: '', ends_on: '' }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.user_id) { setError('Seleccioná un usuario.'); return; }
    if (!form.starts_on || !form.ends_on) { setError('Completá las fechas.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: form.user_id,
          type: form.type,
          starts_on: form.starts_on,
          ends_on: form.ends_on,
          reason: form.reason || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Error al registrar ausencia.');
        return;
      }
      setForm({ user_id: '', type: 'scheduled_leave', starts_on: '', ends_on: '', reason: '' });
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta ausencia?')) return;
    await fetch(`/api/absences/${id}`, { method: 'DELETE' });
    await refresh();
  }

  const filtered = filterUser
    ? absences.filter(a => a.user_id === filterUser)
    : absences;

  return (
    <div className="max-w-4xl space-y-8">
      {/* Formulario */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar ausencia</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Secretario/a</Label>
              <select
                value={form.user_id}
                onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                <option value="">— Seleccioná un usuario —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}{u.position ? ` — ${u.position}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>Tipo</Label>
              <div className="flex gap-3">
                {(['scheduled_leave', 'weekly_pause'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={[
                      'px-4 py-2 rounded-md text-sm border transition-colors',
                      form.type === t
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400',
                    ].join(' ')}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Desde</Label>
                <Input
                  type="date"
                  value={form.starts_on}
                  disabled={form.type === 'weekly_pause'}
                  onChange={e => setForm(f => ({ ...f, starts_on: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Hasta</Label>
                <Input
                  type="date"
                  value={form.ends_on}
                  disabled={form.type === 'weekly_pause'}
                  onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Motivo (opcional)</Label>
              <Input
                placeholder="Vacaciones, licencia médica, etc."
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                maxLength={100}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Registrando...' : 'Registrar ausencia'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Listado */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold text-zinc-800">Ausencias registradas</h2>
          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:outline-none"
          >
            <option value="">Todos los usuarios</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>

        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400">No hay ausencias registradas.</p>
        )}

        {filtered.map(a => (
          <Card key={a.id} className="border-zinc-100">
            <CardContent className="py-4 flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-zinc-900">{a.user_name}</p>
                {a.user_position && (
                  <p className="text-xs text-zinc-500">{a.user_position}</p>
                )}
                <p className="text-sm text-zinc-700 mt-1">
                  {TYPE_LABELS[a.type]} — {formatDate(a.starts_on)} al {formatDate(a.ends_on)}
                </p>
                {a.reason && <p className="text-xs text-zinc-400">{a.reason}</p>}
                <p className="text-xs text-zinc-300">Origen: {SOURCE_LABELS[a.source] ?? a.source}</p>
              </div>
              <button
                onClick={() => handleDelete(a.id)}
                className="text-xs text-red-500 hover:text-red-700 shrink-0 mt-0.5"
              >
                Eliminar
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
