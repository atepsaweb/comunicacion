'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';

const PURPOSE_LABELS: Record<string, string> = {
  extract: 'Extracción',
  assess_completeness: 'Evaluación completitud',
  followup_question: 'Pregunta seguimiento',
  consolidate: 'Consolidación',
  draft_social: 'Borrador redes',
  draft_newsletter: 'Borrador newsletter',
  classify_intent: 'Clasificación intención',
  other: 'Otro',
};

type Log = {
  id: string;
  purpose: string;
  model: string;
  related_cycle_id: string | null;
  cycle_label: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string;
  latency_ms: number;
  success: boolean;
  triggered_by: string;
  created_at: string;
};

interface Props {
  logs: Log[];
}

export function IALogsClient({ logs }: Props) {
  const [purposeFilter, setPurposeFilter] = useState('');
  const [cycleFilter, setCycleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const purposes = Array.from(new Set(logs.map(l => l.purpose))).sort();

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (purposeFilter && l.purpose !== purposeFilter) return false;
      if (cycleFilter && l.cycle_label !== cycleFilter) return false;
      if (dateFrom && l.created_at < dateFrom) return false;
      if (dateTo && l.created_at > dateTo + 'T23:59:59') return false;
      return true;
    });
  }, [logs, purposeFilter, cycleFilter, dateFrom, dateTo]);

  const totalCost = useMemo(() => {
    return filtered.reduce((sum, l) => sum + parseFloat(l.cost_usd), 0);
  }, [filtered]);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Logs de IA</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Llamadas a Claude API — últimas 200. Filtrá por propósito, ciclo o fecha.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:flex md:flex-wrap gap-3 md:gap-4 md:items-end">
          <div className="col-span-2 md:col-auto">
            <label className="block text-xs font-medium text-zinc-600 mb-1">Propósito</label>
            <select
              value={purposeFilter}
              onChange={e => setPurposeFilter(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm bg-white text-zinc-800 w-full md:min-w-[180px] md:w-auto"
            >
              <option value="">Todos</option>
              {purposes.map(p => (
                <option key={p} value={p}>
                  {PURPOSE_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 md:col-auto">
            <label className="block text-xs font-medium text-zinc-600 mb-1">Ciclo (ej: S22/2026)</label>
            <input
              type="text"
              value={cycleFilter}
              onChange={e => setCycleFilter(e.target.value)}
              placeholder="S22/2026"
              className="border rounded px-2 py-1.5 text-sm w-full md:w-32"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-full md:w-auto"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-full md:w-auto"
            />
          </div>
          <button
            onClick={() => { setPurposeFilter(''); setCycleFilter(''); setDateFrom(''); setDateTo(''); }}
            className="col-span-2 md:col-auto text-sm text-zinc-500 hover:text-zinc-800 underline text-left"
          >
            Limpiar
          </button>
        </CardContent>
      </Card>

      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-zinc-600">
          <strong className="text-zinc-900">{filtered.length}</strong> invocaciones
        </span>
        <span className="text-zinc-600">
          Costo total período:{' '}
          <strong className="text-zinc-900">${totalCost.toFixed(4)}</strong>
        </span>
      </div>

      {/* Mobile: cards apiladas */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-zinc-400 text-sm">
            No hay registros para los filtros seleccionados.
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="md:hidden space-y-2">
          {filtered.map(row => (
            <Card key={row.id}>
              <CardContent className="py-3 px-4 space-y-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-zinc-800">
                    {PURPOSE_LABELS[row.purpose] ?? row.purpose}
                  </span>
                  {row.success ? (
                    <span className="text-green-600 font-medium shrink-0">OK</span>
                  ) : (
                    <span className="text-red-500 font-medium shrink-0">Error</span>
                  )}
                </div>
                <p className="text-zinc-500">
                  {new Date(row.created_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {row.cycle_label && <> · {row.cycle_label}</>}
                </p>
                <p className="text-zinc-500 font-mono break-all">
                  {row.model.replace('claude-', '').replace('-20251001', '')}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-600 pt-1">
                  <span>in: {row.input_tokens.toLocaleString('es-AR')}</span>
                  <span>out: {row.output_tokens.toLocaleString('es-AR')}</span>
                  <span className="font-mono text-zinc-800">${parseFloat(row.cost_usd).toFixed(4)}</span>
                </div>
                <p className="text-zinc-400">Disparo: {row.triggered_by}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Desktop: tabla */}
        <Card className="hidden md:block">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-medium text-zinc-600">Fecha</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Propósito</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Modelo</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Ciclo</th>
                  <th className="px-4 py-3 font-medium text-zinc-600 text-right">Tokens in</th>
                  <th className="px-4 py-3 font-medium text-zinc-600 text-right">Tokens out</th>
                  <th className="px-4 py-3 font-medium text-zinc-600 text-right">Costo USD</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Disparo</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}>
                    <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-800">
                      {PURPOSE_LABELS[row.purpose] ?? row.purpose}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs font-mono">
                      {row.model.replace('claude-', '').replace('-20251001', '')}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 text-xs">
                      {row.cycle_label ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-600">
                      {row.input_tokens.toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-600">
                      {row.output_tokens.toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-800">
                      ${parseFloat(row.cost_usd).toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs">
                      {row.triggered_by}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.success ? (
                        <span className="text-green-600 text-xs font-medium">OK</span>
                      ) : (
                        <span className="text-red-500 text-xs font-medium">Error</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
