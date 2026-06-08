'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { REMINDER_DEFAULTS, type ReminderConfig } from '@/lib/ai/prompts/parse-event';

type EventType = 'personal' | 'secretariat' | 'mobilization';

const TYPE_LABELS: Record<EventType, string> = {
  personal:     'Personal',
  secretariat:  'Secretariado',
  mobilization: 'Movilización',
};

const REMINDER_LABELS: [keyof ReminderConfig, string][] = [
  ['7d',      '7 días antes'],
  ['24h',     '24 horas antes'],
  ['12h',     '12 horas antes'],
  ['2h',      '2 horas antes'],
  ['followup', '¿Cómo salió? (al día siguiente)'],
];

interface Props {
  role: string;
}

export function NuevoEventoForm({ role }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('personal');
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [reminders, setReminders] = useState<ReminderConfig>({
    ...REMINDER_DEFAULTS['personal']!,
  });

  function handleTypeChange(t: EventType) {
    setType(t);
    setReminders({ ...(REMINDER_DEFAULTS[t] ?? REMINDER_DEFAULTS['personal']!) });
  }

  function toggleReminder(key: keyof ReminderConfig) {
    setReminders(r => ({ ...r, [key]: !r[key] }));
  }

  const isSecretary = role === 'secretary';
  const statusPreview =
    type === 'personal' || !isSecretary
      ? 'confirmado'
      : 'propuesto (requiere aprobación de la Mesa Ejecutiva)';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) { setError('El título es requerido.'); return; }
    if (!date) { setError('La fecha es requerida.'); return; }

    const startsAt = allDay
      ? `${date}T00:00:00-03:00`
      : `${date}T${time}:00-03:00`;

    let endsAt: string | null = null;
    if (endDate) {
      endsAt = allDay
        ? `${endDate}T23:59:59-03:00`
        : endTime
          ? `${endDate}T${endTime}:00-03:00`
          : `${endDate}T23:59:59-03:00`;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/agenda/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          type,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: allDay,
          location: location.trim() || null,
          description_md: description.trim() || null,
          reminder_config: reminders,
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Error al crear el evento.');
        return;
      }

      const data = await res.json() as { event: { id: string } };
      router.push(`/agenda/${data.event.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Nuevo evento</h1>
        <p className="text-sm text-zinc-500 mt-1">Completá los datos del evento.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Título */}
            <div className="space-y-1">
              <Label htmlFor="ev-title">Título *</Label>
              <Input
                id="ev-title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ej: Reunión con EANA, Asamblea del Secretariado..."
                maxLength={80}
              />
            </div>

            {/* Tipo */}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TYPE_LABELS) as EventType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={[
                      'px-4 py-2 rounded-md text-sm border transition-colors',
                      type === t
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400',
                    ].join(' ')}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-400">
                Estado al guardar:{' '}
                <span className="font-medium text-zinc-600">{statusPreview}</span>
              </p>
            </div>

            {/* Todo el día */}
            <div className="flex items-center gap-2">
              <input
                id="ev-all-day"
                type="checkbox"
                checked={allDay}
                onChange={e => setAllDay(e.target.checked)}
                className="rounded border-zinc-300 h-4 w-4"
              />
              <Label htmlFor="ev-all-day" className="cursor-pointer font-normal">
                Todo el día
              </Label>
            </div>

            {/* Inicio */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="ev-date">Fecha inicio *</Label>
                <Input
                  id="ev-date"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
              </div>
              {!allDay && (
                <div className="space-y-1">
                  <Label htmlFor="ev-time">Hora inicio</Label>
                  <Input
                    id="ev-time"
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Fin (opcional) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="ev-end-date">Fecha fin (opcional)</Label>
                <Input
                  id="ev-end-date"
                  type="date"
                  value={endDate}
                  min={date}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
              {!allDay && endDate && (
                <div className="space-y-1">
                  <Label htmlFor="ev-end-time">Hora fin</Label>
                  <Input
                    id="ev-end-time"
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Lugar */}
            <div className="space-y-1">
              <Label htmlFor="ev-location">Lugar (opcional)</Label>
              <Input
                id="ev-location"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Ej: Sala de reuniones EANA, Aeroparque..."
                maxLength={200}
              />
            </div>

            {/* Descripción */}
            <div className="space-y-1">
              <Label htmlFor="ev-desc">Descripción (opcional)</Label>
              <textarea
                id="ev-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Detalles, agenda, link de videoconferencia..."
                rows={3}
                maxLength={1000}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>

            {/* Recordatorios */}
            <div className="space-y-2">
              <Label>Recordatorios</Label>
              <div className="space-y-1.5">
                {REMINDER_LABELS.map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      id={`rem-${key}`}
                      type="checkbox"
                      checked={reminders[key]}
                      onChange={() => toggleReminder(key)}
                      className="rounded border-zinc-300 h-4 w-4"
                    />
                    <Label htmlFor={`rem-${key}`} className="text-sm font-normal cursor-pointer">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Guardando...' : 'Guardar evento'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/agenda')}
                disabled={submitting}
              >
                Cancelar
              </Button>
            </div>

          </form>
        </CardContent>
      </Card>
    </div>
  );
}
