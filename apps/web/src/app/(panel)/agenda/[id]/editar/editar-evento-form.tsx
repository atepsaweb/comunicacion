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
  secretariat:  'Online',
  mobilization: 'Presencial',
};

const REMINDER_LABELS: [keyof ReminderConfig, string][] = [
  ['7d',      '7 días antes'],
  ['24h',     '24 horas antes'],
  ['2h',      '2 horas antes'],
  ['0h',      'Al momento del evento'],
  ['followup', '¿Cómo salió? (al día siguiente)'],
];

interface UserOption {
  id: string;
  full_name: string;
  position: string | null;
}

interface InitialValues {
  title: string;
  type: string;
  allDay: boolean;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  reminders: ReminderConfig;
  attendeeIds: string[];
}

interface Props {
  eventId: string;
  initial: InitialValues;
  allUsers: UserOption[];
}

export function EditarEventoForm({ eventId, initial, allUsers }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<EventType>((initial.type as EventType) ?? 'personal');
  const [allDay, setAllDay] = useState(initial.allDay);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState(initial.location);
  const [description, setDescription] = useState(initial.description);
  const [reminders, setReminders] = useState<ReminderConfig>(initial.reminders);
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(new Set(initial.attendeeIds));

  function handleTypeChange(t: EventType) {
    setType(t);
    // Resetear recordatorios al cambiar tipo
    setReminders({ ...(REMINDER_DEFAULTS[t] ?? REMINDER_DEFAULTS['personal']!) });
  }

  function toggleReminder(key: keyof ReminderConfig) {
    setReminders(r => ({ ...r, [key]: !r[key] }));
  }

  function toggleAttendee(userId: string) {
    setAttendeeIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

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
      const [eventRes, attendeesRes] = await Promise.all([
        fetch(`/api/agenda/events/${eventId}`, {
          method: 'PATCH',
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
        }),
        fetch(`/api/agenda/events/${eventId}/attendees`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_ids: type === 'personal' ? [] : Array.from(attendeeIds),
          }),
        }),
      ]);

      if (!eventRes.ok) {
        const d = await eventRes.json() as { error?: string };
        setError(d.error ?? 'Error al guardar los cambios.');
        return;
      }
      if (!attendeesRes.ok) {
        const d = await attendeesRes.json() as { error?: string };
        setError(d.error ?? 'Error al actualizar los invitados.');
        return;
      }

      router.push(`/agenda/${eventId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const showAttendees = type === 'secretariat' || type === 'mobilization';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Editar evento</h1>
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

            {/* Lugar / Link */}
            <div className="space-y-1">
              <Label htmlFor="ev-location">
                {type === 'secretariat' ? 'Link de acceso (opcional)' : 'Lugar (opcional)'}
              </Label>
              <Input
                id="ev-location"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder={
                  type === 'secretariat'
                    ? 'https://zoom.us/j/... o meet.google.com/...'
                    : type === 'mobilization'
                      ? 'Ej: Edificio EANA, Av. Costanera...'
                      : 'Ej: Aeroparque, oficina...'
                }
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
                      checked={Boolean(reminders[key])}
                      onChange={() => toggleReminder(key)}
                      className="rounded border-zinc-300 h-4 w-4"
                    />
                    <Label htmlFor={`rem-${key}`} className="text-sm font-normal cursor-pointer">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-400">
                Los recordatorios ya programados no se reprograman al editar; aplican a partir de la próxima confirmación.
              </p>
            </div>

            {/* Invitados */}
            {showAttendees && (
              <div className="space-y-2">
                <Label>
                  Invitados{' '}
                  <span className="font-normal text-zinc-400">
                    ({attendeeIds.size} seleccionados)
                  </span>
                </Label>
                <div className="border border-zinc-200 rounded-md max-h-64 overflow-y-auto divide-y divide-zinc-100">
                  {allUsers.map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-zinc-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={attendeeIds.has(u.id)}
                        onChange={() => toggleAttendee(u.id)}
                        className="rounded border-zinc-300 h-4 w-4 shrink-0"
                      />
                      <span className="text-sm text-zinc-800 flex-1 min-w-0">
                        {u.full_name}
                        {u.position && (
                          <span className="text-zinc-400 ml-1.5 text-xs">{u.position}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAttendeeIds(new Set(allUsers.map(u => u.id)))}
                    className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                  >
                    Seleccionar todos
                  </button>
                  <span className="text-xs text-zinc-300">·</span>
                  <button
                    type="button"
                    onClick={() => setAttendeeIds(new Set())}
                    className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Guardando...' : 'Guardar cambios'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/agenda/${eventId}`)}
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
