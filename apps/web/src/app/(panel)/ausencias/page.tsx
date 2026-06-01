'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Absence = {
  id: string;
  type: 'scheduled_leave' | 'weekly_pause';
  starts_on: string;
  ends_on: string;
  reason: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  scheduled_leave: 'Vacaciones / Licencia',
  weekly_pause: 'Pausa semanal',
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

function isFuture(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr >= today;
}

function getWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  return monday.toISOString().split('T')[0];
}

function getWeekSunday(): string {
  const monday = getWeekMonday();
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split('T')[0];
}

export default function AusenciasPage() {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    type: 'scheduled_leave' as 'scheduled_leave' | 'weekly_pause',
    starts_on: '',
    ends_on: '',
    reason: '',
  });

  const fetchAbsences = useCallback(async () => {
    try {
      const res = await fetch('/api/absences');
      const data = await res.json();
      setAbsences(data.absences ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAbsences(); }, [fetchAbsences]);

  // When type changes to weekly_pause, auto-fill dates for current week
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

    if (!form.starts_on || !form.ends_on) {
      setError('Completá las fechas de inicio y fin.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

      setForm({ type: 'scheduled_leave', starts_on: '', ends_on: '', reason: '' });
      await fetchAbsences();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/absences/${id}`, { method: 'DELETE' });
    await fetchAbsences();
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Ausencias</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Registrá vacaciones o pausas para no recibir recordatorios en ese período.
        </p>
      </div>

      {/* Registrar ausencia */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar ausencia</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="tipo">Tipo</Label>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
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
                <Label htmlFor="starts_on">Desde</Label>
                <Input
                  id="starts_on"
                  type="date"
                  value={form.starts_on}
                  disabled={form.type === 'weekly_pause'}
                  onChange={e => setForm(f => ({ ...f, starts_on: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ends_on">Hasta</Label>
                <Input
                  id="ends_on"
                  type="date"
                  value={form.ends_on}
                  disabled={form.type === 'weekly_pause'}
                  onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))}
                />
              </div>
            </div>

            {form.type === 'scheduled_leave' && (
              <div className="space-y-1">
                <Label htmlFor="reason">Motivo (opcional)</Label>
                <Input
                  id="reason"
                  placeholder="Vacaciones, licencia médica, etc."
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  maxLength={100}
                />
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Registrando...' : 'Registrar ausencia'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Lista de ausencias */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-800">Ausencias registradas</h2>

        {loading && <p className="text-sm text-zinc-400">Cargando...</p>}

        {!loading && absences.length === 0 && (
          <p className="text-sm text-zinc-400">No tenés ausencias registradas.</p>
        )}

        {absences.map(a => {
          const cancellable = isFuture(a.ends_on);
          return (
            <Card key={a.id} className="border-zinc-100">
              <CardContent className="py-4 flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-zinc-800">{TYPE_LABELS[a.type]}</p>
                  <p className="text-sm text-zinc-500">
                    {formatDate(a.starts_on)} — {formatDate(a.ends_on)}
                  </p>
                  {a.reason && <p className="text-xs text-zinc-400">{a.reason}</p>}
                </div>
                {cancellable && (
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="text-xs text-red-500 hover:text-red-700 shrink-0 mt-0.5"
                  >
                    Cancelar
                  </button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
