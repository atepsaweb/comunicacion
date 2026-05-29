'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';

const kindLabel: Record<string, string> = {
  social_instagram: 'Instagram',
  social_x: 'X (Twitter)',
  newsletter: 'Newsletter',
  internal_summary: 'Resumen interno',
};

const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobado',
  published: 'Publicado',
  discarded: 'Descartado',
};

const statusColor: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-600',
  in_review: 'bg-blue-50 text-blue-700',
  approved: 'bg-green-50 text-green-700',
  published: 'bg-green-100 text-green-800',
  discarded: 'bg-red-50 text-red-600',
};

const cycleStatusLabel: Record<string, string> = {
  pending: 'Pendiente',
  open: 'Abierto',
  closed: 'Cerrado',
  processed: 'Procesado',
  published: 'Publicado',
};

type Publication = {
  id: string;
  kind: string;
  status: string;
  updatedAt: Date | string;
  bodyMd: string | null;
};

type Consolidation = {
  id: string;
  summaryMd: string;
  status: string;
  generatedAt: string;
};

type Cycle = {
  id: string;
  isoWeek: number;
  year: number;
  status: string;
  startsAt: string;
  endsAt: string;
};

interface Props {
  cycle: Cycle;
  consolidation: Consolidation | null;
  publications: Publication[];
}

export function RevisionClient({ cycle, consolidation: initialConsolidation, publications: initialPublications }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const [publications, setPublications] = useState(initialPublications);
  const [consolidation, setConsolidation] = useState(initialConsolidation);
  const [showConsolidation, setShowConsolidation] = useState(false);

  const canProcess = cycle.status === 'open' || cycle.status === 'closed' || cycle.status === 'processed';
  const hasProcessed = cycle.status === 'processed' || cycle.status === 'published';

  async function handleProcess() {
    setProcessing(true);
    setProcessError(null);
    try {
      const res = await fetch(`/api/cycles/${cycle.id}/process`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setProcessError(data.error ?? 'Error al procesar el ciclo.');
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setProcessError('Error de red al procesar el ciclo.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleApprove(pubId: string) {
    setActionPending(pubId + '-approve');
    try {
      const res = await fetch(`/api/publications/${pubId}/approve`, { method: 'POST' });
      if (res.ok) {
        setPublications(prev => prev.map(p => p.id === pubId ? { ...p, status: 'approved' } : p));
      }
    } finally {
      setActionPending(null);
    }
  }

  async function handleDiscard(pubId: string) {
    setActionPending(pubId + '-discard');
    try {
      const res = await fetch(`/api/publications/${pubId}/discard`, { method: 'POST' });
      if (res.ok) {
        setPublications(prev => prev.map(p => p.id === pubId ? { ...p, status: 'discarded' } : p));
      }
    } finally {
      setActionPending(null);
    }
  }

  function startEdit(pub: Publication) {
    setEditingId(pub.id);
    setEditText(pub.bodyMd ?? '');
  }

  async function handleSaveVersion(pubId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/publications/${pubId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_md: editText }),
      });
      if (res.ok) {
        setPublications(prev =>
          prev.map(p => p.id === pubId ? { ...p, bodyMd: editText } : p),
        );
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const startDate = new Date(cycle.startsAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'long' });
  const endDate = new Date(cycle.endsAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Encabezado */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Revisión</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Semana {cycle.isoWeek}/{cycle.year} · {startDate} al {endDate}
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium">
              {cycleStatusLabel[cycle.status] ?? cycle.status}
            </span>
          </p>
        </div>

        {/* Botón procesar */}
        {canProcess && (
          <button
            onClick={handleProcess}
            disabled={processing || isPending}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {processing ? 'Procesando…' : hasProcessed ? 'Reprocesar ciclo' : 'Procesar ciclo'}
          </button>
        )}
      </div>

      {processError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {processError}
        </div>
      )}

      {processing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Generando consolidado y drafts con IA. Esto puede tardar 30-60 segundos…
        </div>
      )}

      {/* Consolidación interna */}
      {consolidation && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900 text-sm">Consolidado interno</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">
                  {new Date(consolidation.generatedAt).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <button
                  onClick={() => setShowConsolidation(!showConsolidation)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                >
                  {showConsolidation ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>
            {showConsolidation && (
              <pre className="text-xs text-zinc-700 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-50 rounded-md p-4 max-h-[500px] overflow-auto">
                {consolidation.summaryMd}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sin consolidación todavía */}
      {!consolidation && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-zinc-400 text-sm">
              {cycle.status === 'open'
                ? 'El ciclo está abierto. Hacé clic en "Procesar ciclo" para generar el consolidado y los drafts.'
                : cycle.status === 'closed'
                ? 'El ciclo está cerrado. Hacé clic en "Procesar ciclo" para generar el consolidado y los drafts.'
                : 'No hay consolidado generado todavía.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Publicaciones */}
      {publications.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
            Borradores de publicación
          </h2>
          {publications.map(pub => (
            <Card key={pub.id}>
              <CardContent className="py-4 px-5 space-y-3">
                {/* Header de la publicación */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="font-medium text-zinc-900 text-sm">
                      {kindLabel[pub.kind] ?? pub.kind}
                    </h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[pub.status] ?? 'bg-zinc-100 text-zinc-500'}`}
                    >
                      {statusLabel[pub.status] ?? pub.status}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (expandedId === pub.id) {
                        setExpandedId(null);
                        setEditingId(null);
                      } else {
                        setExpandedId(pub.id);
                      }
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                  >
                    {expandedId === pub.id ? 'Cerrar' : 'Ver / Editar'}
                  </button>
                </div>

                {/* Contenido expandido */}
                {expandedId === pub.id && (
                  <div className="space-y-3 pt-1">
                    {editingId === pub.id ? (
                      <>
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={12}
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveVersion(pub.id)}
                            disabled={saving}
                            className="px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                          >
                            {saving ? 'Guardando…' : 'Guardar versión'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-zinc-500 text-xs hover:text-zinc-800 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <pre className="text-xs text-zinc-700 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-50 rounded-md p-4 max-h-[400px] overflow-auto">
                          {pub.bodyMd ?? '(sin contenido)'}
                        </pre>
                        <button
                          onClick={() => startEdit(pub)}
                          className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                        >
                          Editar
                        </button>
                      </>
                    )}

                    {/* Acciones de aprobación */}
                    {pub.status !== 'approved' && pub.status !== 'discarded' && editingId !== pub.id && (
                      <div className="flex items-center gap-2 pt-1 border-t border-zinc-100">
                        <button
                          onClick={() => handleApprove(pub.id)}
                          disabled={actionPending !== null}
                          className="px-3 py-1.5 bg-green-700 text-white text-xs font-medium rounded hover:bg-green-800 disabled:opacity-50 transition-colors"
                        >
                          {actionPending === pub.id + '-approve' ? 'Aprobando…' : 'Aprobar'}
                        </button>
                        <button
                          onClick={() => handleDiscard(pub.id)}
                          disabled={actionPending !== null}
                          className="px-3 py-1.5 bg-white border border-zinc-300 text-zinc-600 text-xs font-medium rounded hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                        >
                          {actionPending === pub.id + '-discard' ? 'Descartando…' : 'Descartar'}
                        </button>
                      </div>
                    )}

                    {pub.status === 'approved' && (
                      <p className="text-xs text-green-700 font-medium pt-1">
                        Aprobado — listo para copiar y publicar manualmente.
                      </p>
                    )}
                    {pub.status === 'discarded' && (
                      <p className="text-xs text-red-600 font-medium pt-1">
                        Descartado.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Estado sin publicaciones pero con ciclo procesado */}
      {publications.length === 0 && hasProcessed && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-zinc-400 text-sm">No se generaron publicaciones. Probá &ldquo;Reprocesar ciclo&rdquo;.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
