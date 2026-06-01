'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  published: 'Enviado',
};

const cycleStatusColor: Record<string, string> = {
  open: 'bg-green-50 text-green-700',
  closed: 'bg-yellow-50 text-yellow-700',
  processed: 'bg-blue-50 text-blue-700',
  published: 'bg-green-50 text-green-700',
};

// Badge del ciclo actual teniendo en cuenta aprobación del consolidado
function getCycleBadge(
  status: string,
  consolidationApproved: boolean,
): { label: string; color: string } {
  if (status === 'published') return { label: 'Enviado', color: 'bg-green-50 text-green-700' };
  if (status === 'processed' && consolidationApproved) {
    return { label: 'Aprobado', color: 'bg-indigo-50 text-indigo-700' };
  }
  return {
    label: cycleStatusLabel[status] ?? status,
    color: cycleStatusColor[status] ?? 'bg-zinc-100 text-zinc-600',
  };
}

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

type PastCycle = {
  id: string;
  isoWeek: number;
  year: number;
  status: string;
  startsAt: string;
};

interface Props {
  cycle: Cycle;
  consolidation: Consolidation | null;
  publications: Publication[];
  allCycles: PastCycle[];
  isHistoryView: boolean; // true cuando se navega a un ciclo pasado vía ?cycleId=
}

export function RevisionClient({
  cycle,
  consolidation: initialConsolidation,
  publications: initialPublications,
  allCycles,
  isHistoryView,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // Estado publicaciones
  const [publications, setPublications] = useState(initialPublications);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingPubId, setEditingPubId] = useState<string | null>(null);
  const [editPubText, setEditPubText] = useState('');
  const [savingPub, setSavingPub] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  // Estado consolidado
  const [consolidation, setConsolidation] = useState(initialConsolidation);
  const [showConsolidation, setShowConsolidation] = useState(false);
  const [editingConsolidation, setEditingConsolidation] = useState(false);
  const [editConsolidationText, setEditConsolidationText] = useState('');
  const [savingConsolidation, setSavingConsolidation] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  // Estado consolidado — aprobación
  const [consolidationApproved, setConsolidationApproved] = useState(
    initialConsolidation?.status === 'approved' || initialConsolidation?.status === 'sent',
  );
  const [approvingConsolidation, setApprovingConsolidation] = useState(false);

  // Estado ciclo
  const [cyclePublished, setCyclePublished] = useState(cycle.status === 'published');
  const [publishPending, setPublishPending] = useState(false);

  // Estado historial
  const [showHistory, setShowHistory] = useState(false);

  const canProcess = cycle.status === 'open' || cycle.status === 'closed' || cycle.status === 'processed';
  const hasProcessed = cycle.status === 'processed' || cycle.status === 'published';

  // Publicaciones visibles: las descartadas desaparecen de la lista
  const visiblePublications = publications.filter(p => p.status !== 'discarded');

  // Contadores para "Marcar como Enviado" (excluye descartadas — ya decididas)
  const approvedCount = visiblePublications.filter(p => p.status === 'approved').length;
  const pendingCount = visiblePublications.filter(p => p.status === 'draft' || p.status === 'in_review').length;

  // ─── Acciones de ciclo ──────────────────────────────────────────────────────

  async function handleProcess() {
    setProcessing(true);
    setProcessError(null);
    try {
      const res = await fetch(`/api/cycles/${cycle.id}/process`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setProcessError((data as { error?: string }).error ?? 'Error al procesar el ciclo.');
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setProcessError('Error de red al procesar el ciclo.');
    } finally {
      setProcessing(false);
    }
  }

  async function handlePublish() {
    setPublishPending(true);
    try {
      const res = await fetch(`/api/cycles/${cycle.id}/publish`, { method: 'POST' });
      if (res.ok) {
        setCyclePublished(true);
        startTransition(() => router.refresh());
      }
    } finally {
      setPublishPending(false);
    }
  }

  // ─── Acciones de consolidado ────────────────────────────────────────────────

  async function handleApproveConsolidation() {
    if (!consolidation) return;
    setApprovingConsolidation(true);
    try {
      const res = await fetch(`/api/consolidations/${consolidation.id}/approve`, { method: 'POST' });
      if (res.ok) setConsolidationApproved(true);
    } finally {
      setApprovingConsolidation(false);
    }
  }

  function startEditConsolidation() {
    setEditConsolidationText(consolidation?.summaryMd ?? '');
    setEditingConsolidation(true);
    setShowConsolidation(true);
  }

  async function handleSaveConsolidation() {
    if (!consolidation) return;
    setSavingConsolidation(true);
    try {
      const res = await fetch(`/api/consolidations/${consolidation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_summary_md: editConsolidationText }),
      });
      if (res.ok) {
        setConsolidation(prev => prev ? { ...prev, summaryMd: editConsolidationText } : prev);
        setEditingConsolidation(false);
      }
    } finally {
      setSavingConsolidation(false);
    }
  }

  async function handleDownloadDocx() {
    if (!consolidation) return;
    setDownloadingDocx(true);
    try {
      const res = await fetch(`/api/consolidations/${consolidation.id}/export`);
      if (!res.ok) return;
      const blob = await res.blob();
      const cycle_label = `semana-${cycle.isoWeek}-${cycle.year}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ATEPSA-${cycle_label}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingDocx(false);
    }
  }

  function handlePrintPdf() {
    window.print();
  }

  // ─── Acciones de publicaciones ──────────────────────────────────────────────

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

  function startEditPub(pub: Publication) {
    setEditingPubId(pub.id);
    setEditPubText(pub.bodyMd ?? '');
  }

  async function handleSavePubVersion(pubId: string) {
    setSavingPub(true);
    try {
      const res = await fetch(`/api/publications/${pubId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_md: editPubText }),
      });
      if (res.ok) {
        setPublications(prev => prev.map(p => p.id === pubId ? { ...p, bodyMd: editPubText } : p));
        setEditingPubId(null);
      }
    } finally {
      setSavingPub(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const startDate = new Date(cycle.startsAt).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const endDate = new Date(cycle.endsAt).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  const pastCycles = allCycles.filter(c => c.id !== cycle.id);

  return (
    <div className="space-y-6 max-w-4xl print:max-w-full">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between print:hidden gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Revisión</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Semana {cycle.isoWeek}/{cycle.year} · {startDate} al {endDate}
            {(() => {
              const badge = getCycleBadge(cycle.status, consolidationApproved);
              return (
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                  {badge.label}
                </span>
              );
            })()}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Reprocesar — solo cuando no está publicado (o para republicar) */}
          {canProcess && !cyclePublished && (
            <button
              onClick={handleProcess}
              disabled={processing || isPending}
              className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {processing ? 'Procesando…' : hasProcessed ? 'Reprocesar ciclo' : 'Procesar ciclo'}
            </button>
          )}

          {/* Finalizar semana */}
          {hasProcessed && !cyclePublished && !isHistoryView && (
            <button
              onClick={handlePublish}
              disabled={publishPending || isPending}
              className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-md hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {publishPending
                ? 'Marcando…'
                : pendingCount > 0
                  ? `Marcar como Enviado (${approvedCount} ✓, ${pendingCount} pendientes)`
                  : `Marcar como Enviado (${approvedCount} aprobadas)`}
            </button>
          )}

          {cyclePublished && (
            <span className="text-sm text-green-700 font-medium px-3 py-2 bg-green-50 rounded-md border border-green-200">
              ✓ Semana finalizada
            </span>
          )}
        </div>
      </div>

      {processError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
          {processError}
        </div>
      )}

      {processing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 print:hidden">
          Generando consolidado y drafts con IA. Esto puede tardar 60-90 segundos…
        </div>
      )}

      {/* ── Consolidado interno ─────────────────────────────────────────────── */}
      {consolidation && (
        <Card>
          <CardContent className="py-4 px-4 sm:px-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 print:hidden">
              <h2 className="font-semibold text-zinc-900 text-sm">Consolidado interno</h2>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-xs text-zinc-400">
                  {new Date(consolidation.generatedAt).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>

                {!editingConsolidation && (
                  <>
                    <button
                      onClick={() => setShowConsolidation(!showConsolidation)}
                      className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                    >
                      {showConsolidation ? 'Ocultar' : 'Ver'}
                    </button>
                    {showConsolidation && (
                      <button
                        onClick={startEditConsolidation}
                        className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      onClick={handleDownloadDocx}
                      disabled={downloadingDocx}
                      className="text-xs px-2.5 py-1 bg-zinc-800 text-white rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {downloadingDocx ? 'Generando…' : '⬇ Descargar .docx'}
                    </button>
                    <button
                      onClick={handlePrintPdf}
                      className="text-xs px-2.5 py-1 bg-white border border-zinc-300 text-zinc-700 rounded hover:bg-zinc-50 transition-colors"
                    >
                      🖨 Imprimir / PDF
                    </button>
                    {consolidationApproved ? (
                      <span className="text-xs text-green-700 font-medium px-2.5 py-1 bg-green-50 border border-green-200 rounded">
                        ✓ Aprobado
                      </span>
                    ) : (
                      <button
                        onClick={handleApproveConsolidation}
                        disabled={approvingConsolidation}
                        className="text-xs px-2.5 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50 transition-colors"
                      >
                        {approvingConsolidation ? 'Aprobando…' : 'Aprobar'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {editingConsolidation ? (
              <div className="space-y-3">
                <textarea
                  value={editConsolidationText}
                  onChange={e => setEditConsolidationText(e.target.value)}
                  rows={20}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveConsolidation}
                    disabled={savingConsolidation}
                    className="px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {savingConsolidation ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => setEditingConsolidation(false)}
                    className="px-3 py-1.5 text-zinc-500 text-xs hover:text-zinc-800 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : showConsolidation && (
              <pre className="text-xs text-zinc-700 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-50 rounded-md p-4 max-h-[600px] overflow-auto print:max-h-none print:overflow-visible print:bg-white print:p-0 print:text-sm">
                {consolidation.summaryMd}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {!consolidation && (
        <Card className="border-dashed print:hidden">
          <CardContent className="py-8 text-center">
            <p className="text-zinc-400 text-sm">
              {cycle.status === 'open' || cycle.status === 'closed'
                ? 'Hacé clic en "Procesar ciclo" para generar el consolidado y los drafts.'
                : 'No hay consolidado generado todavía.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Confirmación post-envío ─────────────────────────────────────────── */}
      {cyclePublished && !isHistoryView && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800 print:hidden flex items-center justify-between gap-4">
          <span>✓ Semana marcada como enviada. Ya no aparece en la vista principal.</span>
          <Link href="/reportes" className="text-green-700 font-medium underline underline-offset-2 hover:text-green-900 shrink-0">
            Ver archivo →
          </Link>
        </div>
      )}

      {/* ── Publicaciones ───────────────────────────────────────────────────── */}
      {visiblePublications.length > 0 && (
        <div className="space-y-3 print:hidden">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
            Borradores de publicación
          </h2>
          {visiblePublications.map(pub => (
            <Card key={pub.id}>
              <CardContent className="py-4 px-4 sm:px-5 space-y-3">

                {/* ── Card header: nombre + estado + botones rápidos ── */}
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-medium text-zinc-900 text-sm shrink-0">
                    {kindLabel[pub.kind] ?? pub.kind}
                  </h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor[pub.status] ?? 'bg-zinc-100 text-zinc-500'}`}
                  >
                    {statusLabel[pub.status] ?? pub.status}
                  </span>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Botones rápidos — visibles sin expandir */}
                  {pub.status !== 'approved' && pub.status !== 'discarded' && editingPubId !== pub.id && (
                    <>
                      <button
                        onClick={() => handleApprove(pub.id)}
                        disabled={actionPending !== null}
                        className="px-3 py-1 bg-green-700 text-white text-xs font-medium rounded hover:bg-green-800 disabled:opacity-50 transition-colors shrink-0"
                      >
                        {actionPending === pub.id + '-approve' ? '…' : 'Aprobar'}
                      </button>
                      <button
                        onClick={() => handleDiscard(pub.id)}
                        disabled={actionPending !== null}
                        className="px-3 py-1 bg-white border border-zinc-300 text-zinc-600 text-xs font-medium rounded hover:bg-zinc-50 disabled:opacity-50 transition-colors shrink-0"
                      >
                        {actionPending === pub.id + '-discard' ? '…' : 'Descartar'}
                      </button>
                    </>
                  )}

                  {pub.status === 'approved' && (
                    <span className="text-xs text-green-700 font-medium shrink-0">✓ Aprobado</span>
                  )}
                  {pub.status === 'discarded' && (
                    <span className="text-xs text-red-500 shrink-0">Descartado</span>
                  )}

                  <button
                    onClick={() => {
                      if (expandedId === pub.id) {
                        setExpandedId(null);
                        setEditingPubId(null);
                      } else {
                        setExpandedId(pub.id);
                      }
                    }}
                    className="text-xs text-zinc-400 hover:text-zinc-700 underline underline-offset-2 shrink-0"
                  >
                    {expandedId === pub.id ? 'Cerrar' : 'Ver / Editar'}
                  </button>
                </div>

                {/* ── Contenido expandido ── */}
                {expandedId === pub.id && (
                  <div className="space-y-3 pt-1 border-t border-zinc-100">
                    {editingPubId === pub.id ? (
                      <>
                        <textarea
                          value={editPubText}
                          onChange={e => setEditPubText(e.target.value)}
                          rows={12}
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSavePubVersion(pub.id)}
                            disabled={savingPub}
                            className="px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                          >
                            {savingPub ? 'Guardando…' : 'Guardar versión'}
                          </button>
                          <button
                            onClick={() => setEditingPubId(null)}
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
                          onClick={() => startEditPub(pub)}
                          className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                        >
                          Editar contenido
                        </button>
                      </>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {publications.length === 0 && hasProcessed && (
        <Card className="border-dashed print:hidden">
          <CardContent className="py-8 text-center">
            <p className="text-zinc-400 text-sm">No se generaron publicaciones. Probá &ldquo;Reprocesar ciclo&rdquo;.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Historial de semanas ─────────────────────────────────────────────── */}
      {pastCycles.length > 0 && (
        <div className="pt-4 border-t border-zinc-100 print:hidden">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider hover:text-zinc-600 transition-colors"
          >
            <span>{showHistory ? '▾' : '▸'}</span>
            Semanas anteriores ({pastCycles.length})
          </button>

          {showHistory && (
            <ul className="mt-3 space-y-1">
              {pastCycles.map(c => (
                <li key={c.id}>
                  <Link
                    href={`/revision?cycleId=${c.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-zinc-50 transition-colors"
                  >
                    <span className="text-zinc-700 font-medium">
                      Semana {c.isoWeek}/{c.year}
                    </span>
                    <span className="text-zinc-400 text-xs">
                      {new Date(c.startsAt).toLocaleDateString('es-AR', {
                        day: '2-digit', month: '2-digit',
                        timeZone: 'America/Argentina/Buenos_Aires',
                      })}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${cycleStatusColor[c.status] ?? 'bg-zinc-100 text-zinc-500'}`}
                    >
                      {cycleStatusLabel[c.status] ?? c.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </div>
  );
}
