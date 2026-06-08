'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, Calendar, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AgendaEventRow = {
  id: string;
  title: string;
  type: 'personal' | 'secretariat' | 'mobilization';
  status: 'proposed' | 'confirmed' | 'cancelled' | 'done';
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  created_by: string;
  is_important: boolean;
  creator_name: string | null;
};

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const TYPE_CHIP: Record<AgendaEventRow['type'], string> = {
  personal:     'bg-zinc-600 text-white',
  secretariat:  'bg-[#2E3863] text-white',
  mobilization: 'bg-red-600 text-white',
};

const TYPE_LABEL: Record<AgendaEventRow['type'], string> = {
  personal:     'Personal',
  secretariat:  'Secretariado',
  mobilization: 'Movilización',
};

const STATUS_CHIP: Partial<Record<AgendaEventRow['status'], string>> = {
  proposed:  'bg-amber-500 text-white',
  done:      'bg-zinc-300 text-zinc-600',
  cancelled: 'bg-zinc-100 text-zinc-400',
};

const STATUS_LABEL: Record<AgendaEventRow['status'], string> = {
  proposed:  'Propuesto',
  confirmed: 'Confirmado',
  done:      'Finalizado',
  cancelled: 'Cancelado',
};

function chipClass(ev: AgendaEventRow): string {
  return STATUS_CHIP[ev.status] ?? TYPE_CHIP[ev.type];
}

function toARTDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function toARTTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getGridDays(year: number, month: number): Date[] {
  const rawDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = rawDow === 0 ? 6 : rawDow - 1;
  return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(year, month, 1 - offset + i)));
}

function todayART(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

interface Props {
  userId: string;
  role: string;
}

export function AgendaClient({ userId, role }: Props) {
  const router = useRouter();
  const now = new Date();

  const [view, setView] = useState<'month' | 'list'>('month');
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const [events, setEvents] = useState<AgendaEventRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const gridDays = getGridDays(year, month);
  const gridFrom = gridDays[0]!.toISOString().split('T')[0]!;
  const gridTo = gridDays[41]!.toISOString().split('T')[0]!;
  const todayStr = todayART();

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agenda/events?from=${gridFrom}&to=${gridTo}`);
      const data = await res.json() as { events?: AgendaEventRow[] };
      setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, [gridFrom, gridTo]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  function prevMonth() {
    setSelectedDay(null);
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    setSelectedDay(null);
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function goToday() {
    const n = new Date();
    setYear(n.getUTCFullYear());
    setMonth(n.getUTCMonth());
    setSelectedDay(null);
  }

  // Index events by ART day
  const byDay: Record<string, AgendaEventRow[]> = {};
  for (const ev of events ?? []) {
    const d = toARTDate(ev.starts_at);
    (byDay[d] ??= []).push(ev);
  }

  const canCreate = role !== 'executive';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Agenda</h1>
        {canCreate && (
          <Button size="sm" onClick={() => router.push('/agenda/nuevo')}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo evento
          </Button>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-zinc-800 min-w-[140px] text-center">
            {MESES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={goToday}
          className="text-xs px-2.5 py-1.5 rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          Hoy
        </button>

        <div className="flex ml-auto rounded-md border border-zinc-200 overflow-hidden">
          {(['month', 'list'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                view === v ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50',
              )}
            >
              {v === 'month' ? (
                <><Calendar className="h-3.5 w-3.5" />Mes</>
              ) : (
                <><List className="h-3.5 w-3.5" />Lista</>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Month view */}
      {view === 'month' && (
        <div>
          <div className="grid grid-cols-7 mb-1">
            {DIAS_CORTOS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-zinc-400 py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-t border-l border-zinc-200 rounded-sm overflow-hidden">
            {gridDays.map(day => {
              const dayStr = day.toISOString().split('T')[0]!;
              const isCurrent = day.getUTCMonth() === month;
              const isToday = dayStr === todayStr;
              const isSel = dayStr === selectedDay;
              const dayEvs = byDay[dayStr] ?? [];
              const visible = dayEvs.slice(0, 3);
              const overflow = dayEvs.length - 3;

              return (
                <div
                  key={dayStr}
                  onClick={() => setSelectedDay(isSel ? null : dayStr)}
                  className={cn(
                    'border-b border-r border-zinc-200 min-h-[80px] p-1 cursor-pointer transition-colors select-none',
                    isCurrent ? 'bg-white hover:bg-zinc-50' : 'bg-zinc-50 hover:bg-zinc-100',
                    isSel && 'ring-2 ring-inset ring-[#2E3863]',
                  )}
                >
                  <div className={cn(
                    'text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full leading-none',
                    isToday ? 'bg-[#2E3863] text-white' : isCurrent ? 'text-zinc-800' : 'text-zinc-400',
                  )}>
                    {day.getUTCDate()}
                  </div>
                  <div className="space-y-0.5">
                    {visible.map(ev => (
                      <Link
                        key={ev.id}
                        href={`/agenda/${ev.id}`}
                        onClick={e => e.stopPropagation()}
                        className={cn(
                          'block text-xs px-1 py-0.5 rounded truncate leading-tight',
                          chipClass(ev),
                          ev.status === 'cancelled' && 'line-through opacity-60',
                        )}
                        title={ev.title}
                      >
                        {!ev.all_day && (
                          <span className="opacity-70 mr-0.5 tabular-nums">
                            {toARTTime(ev.starts_at)}
                          </span>
                        )}
                        {ev.title}
                      </Link>
                    ))}
                    {overflow > 0 && (
                      <p className="text-xs text-zinc-400 px-1">+{overflow} más</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected day panel */}
          {selectedDay && (
            <div className="mt-4 space-y-2">
              <h2 className="text-sm font-semibold text-zinc-700">
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString('es-AR', {
                  weekday: 'long', day: 'numeric', month: 'long',
                  timeZone: 'America/Argentina/Buenos_Aires',
                })}
              </h2>
              {(byDay[selectedDay] ?? []).length === 0 ? (
                <p className="text-sm text-zinc-400">Sin eventos este día.</p>
              ) : (
                (byDay[selectedDay] ?? []).map(ev => (
                  <EventCard key={ev.id} ev={ev} userId={userId} />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="space-y-2">
          {loading && <p className="text-sm text-zinc-400">Cargando...</p>}
          {!loading && (events ?? []).length === 0 && (
            <p className="text-sm text-zinc-400">Sin eventos en este período.</p>
          )}
          {(events ?? []).map(ev => (
            <EventCard key={ev.id} ev={ev} userId={userId} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ ev, userId }: { ev: AgendaEventRow; userId: string }) {
  const artDate = new Date(ev.starts_at).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const artTime = ev.all_day
    ? 'Todo el día'
    : new Date(ev.starts_at).toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });

  return (
    <Link href={`/agenda/${ev.id}`}>
      <div className={cn(
        'flex gap-3 p-3 rounded-lg border bg-white transition-colors hover:border-zinc-300',
        ev.status === 'cancelled' ? 'border-zinc-100 opacity-60' : 'border-zinc-200',
      )}>
        <div className={cn('w-1 rounded-full shrink-0 self-stretch', chipClass(ev))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              'text-sm font-medium text-zinc-900 leading-snug',
              ev.status === 'cancelled' && 'line-through text-zinc-500',
            )}>
              {ev.is_important && <span className="text-red-500 mr-1">●</span>}
              {ev.title}
            </p>
            <span className="text-xs text-zinc-400 shrink-0 mt-0.5">{STATUS_LABEL[ev.status]}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{artDate} · {artTime}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-400">{TYPE_LABEL[ev.type]}</span>
            {ev.location && <span className="text-xs text-zinc-400">· {ev.location}</span>}
            {ev.created_by === userId && <span className="text-xs text-zinc-300">· mío</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
