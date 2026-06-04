'use client';

// Vista de "Mis mensajes" con la misma estética que /admin/mensajes (tabla en
// desktop, cards en mobile, badges por tipo, expand inline, auto-refresh) pero
// sin columna de autor: el secretario sólo ve los suyos.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FileType2,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  RefreshCw,
  Trash2,
} from 'lucide-react';

const REFRESH_INTERVAL_MS = 10_000;

export type MensajeRow = {
  id: string;
  kind: 'text' | 'audio' | 'other';
  mimeType: string | null;
  textContent: string | null;
  receivedAt: string;
  processedAt: string | null;
  transcriptionText: string | null;
  transcriptionDuration: number | null;
  documentText: string | null;
  documentMethod: string | null;
};

type KindBadge = { label: string; classes: string; Icon: React.ElementType };

function kindBadge(kind: string, mimeType: string | null): KindBadge {
  if (kind === 'text') {
    return { label: 'Texto', classes: 'bg-blue-50 text-blue-700 border-blue-200', Icon: MessageSquare };
  }
  if (kind === 'audio') {
    return { label: 'Audio', classes: 'bg-violet-50 text-violet-700 border-violet-200', Icon: Mic };
  }
  if (mimeType?.startsWith('image/')) {
    return { label: 'Imagen', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: ImageIcon };
  }
  if (mimeType === 'application/pdf') {
    return { label: 'PDF', classes: 'bg-amber-50 text-amber-700 border-amber-200', Icon: FileType2 };
  }
  if (mimeType?.includes('wordprocessingml') || mimeType === 'application/msword') {
    return { label: 'Word', classes: 'bg-amber-50 text-amber-700 border-amber-200', Icon: FileText };
  }
  if (mimeType === 'text/plain') {
    return { label: 'Transcripción .txt', classes: 'bg-amber-50 text-amber-700 border-amber-200', Icon: FileText };
  }
  return { label: 'Archivo', classes: 'bg-zinc-100 text-zinc-700 border-zinc-200', Icon: FileText };
}

type Status = { kind: 'processed' } | { kind: 'pending' };

function statusOf(msg: MensajeRow): Status {
  if (
    msg.kind === 'text' ||
    msg.transcriptionText ||
    msg.documentText ||
    msg.processedAt
  ) {
    return { kind: 'processed' };
  }
  return { kind: 'pending' };
}

function fullContent(msg: MensajeRow): string {
  if (msg.kind === 'text') return msg.textContent ?? '';
  if (msg.transcriptionText) return msg.transcriptionText;
  if (msg.documentText) return msg.documentText;
  return '';
}

function preview(msg: MensajeRow, maxChars = 110): string {
  const text = fullContent(msg);
  if (!text) return '';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? oneLine.slice(0, maxChars).trim() + '…' : oneLine;
}

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
    time: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function secondsAgo(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
}

interface Props {
  initialMessages: MensajeRow[];
}

export function MisMensajesClient({ initialMessages }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [, force] = useState(0);
  const inflight = useRef(false);

  // Si una fila se está borrando, la sacamos de la vista de inmediato (optimistic)
  const visible = useMemo(
    () => initialMessages.filter(m => m.id !== deletingId),
    [initialMessages, deletingId],
  );

  // Auto-refresh cada 10s
  useEffect(() => {
    const id = setInterval(() => {
      if (inflight.current) return;
      inflight.current = true;
      router.refresh();
      setLastRefresh(new Date());
      setTimeout(() => { inflight.current = false; }, 500);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  // Tick para el contador "hace Xs"
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminar este mensaje? No se va a contar para el reporte y no aparecerá más en esta lista.')) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('No se pudo eliminar el mensaje.');
        setDeletingId(null);
        return;
      }
      router.refresh();
      setLastRefresh(new Date());
      // Soltar el deletingId después del refresh para que el optimistic siga hasta
      // que llegue la nueva tanda del server (que ya no incluirá el mensaje).
      setTimeout(() => setDeletingId(null), 800);
    } catch {
      setDeletingId(null);
      alert('Error de conexión al eliminar.');
    }
  }

  function refreshNow() {
    router.refresh();
    setLastRefresh(new Date());
  }

  const secs = secondsAgo(lastRefresh);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Mis mensajes</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Mensajes que enviaste al bot. Refresca automáticamente cada 10 s.
          </p>
        </div>
        <button
          onClick={refreshNow}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50 self-start md:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizado hace {secs}s
        </button>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white py-10 text-center text-sm text-zinc-400">
            Todavía no enviaste mensajes. Mandá un audio o texto al WhatsApp del Secretariado.
          </div>
        ) : (
          visible.map(msg => {
            const isExpanded = expanded.has(msg.id);
            const badge = kindBadge(msg.kind, msg.mimeType);
            const { date, time } = formatDateTime(msg.receivedAt);
            const st = statusOf(msg);
            const Badge = badge.Icon;
            const text = preview(msg);
            const full = fullContent(msg);
            return (
              <div
                key={msg.id}
                className="rounded-lg border border-zinc-200 bg-white"
              >
                <button
                  onClick={() => toggle(msg.id)}
                  className="w-full text-left px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium text-zinc-700 tabular-nums">
                      {date} · {time}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.classes}`}>
                      <Badge className="h-3 w-3" />
                      {badge.label}
                    </span>
                  </div>
                  {text ? (
                    <p className="text-sm text-zinc-700 line-clamp-2">{text}</p>
                  ) : (
                    <p className="text-sm text-zinc-400 italic">
                      {st.kind === 'pending' ? 'Procesando…' : '—'}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      st.kind === 'processed' ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      {st.kind === 'processed' ? 'procesado' : 'pendiente'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {isExpanded ? 'Ocultar' : 'Ver más'}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-zinc-100 pt-3 space-y-3">
                    <div className="text-sm text-zinc-800 whitespace-pre-wrap break-words">
                      {full || <span className="text-zinc-400 italic">Sin contenido extraído.</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500 space-y-0.5">
                      {msg.transcriptionDuration != null && (
                        <p>Duración audio: {msg.transcriptionDuration}s</p>
                      )}
                      {msg.documentMethod && (
                        <p>Método extracción: {msg.documentMethod}</p>
                      )}
                      <p>Recibido: {new Date(msg.receivedAt).toLocaleString('es-AR')}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(msg.id)}
                      disabled={deletingId === msg.id}
                      className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar mensaje
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[7.5rem]">Recibido</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[8rem]">Tipo</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600">Contenido</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[7.5rem]">Estado</th>
              <th className="px-3 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-zinc-400 text-sm">
                  Todavía no enviaste mensajes. Mandá un audio o texto al WhatsApp del Secretariado.
                </td>
              </tr>
            )}
            {visible.map((msg, i) => {
              const isExpanded = expanded.has(msg.id);
              const badge = kindBadge(msg.kind, msg.mimeType);
              const { date, time } = formatDateTime(msg.receivedAt);
              const st = statusOf(msg);
              const Badge = badge.Icon;
              const text = preview(msg);
              const full = fullContent(msg);
              const stripe = i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50';
              return (
                <Fragment key={msg.id}>
                  <tr
                    onClick={() => toggle(msg.id)}
                    className={`${stripe} cursor-pointer hover:bg-zinc-50 transition-colors`}
                  >
                    <td className="px-3 py-2.5 text-xs text-zinc-600 tabular-nums whitespace-nowrap align-top">
                      <div className="font-medium text-zinc-700">{time}</div>
                      <div className="text-zinc-400">{date}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.classes}`}>
                        <Badge className="h-3 w-3" />
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top text-zinc-700 text-sm">
                      {text ? (
                        <span className="line-clamp-2">{text}</span>
                      ) : (
                        <span className="text-zinc-400 italic text-xs">
                          {st.kind === 'pending' ? 'Procesando…' : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        st.kind === 'processed' ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-600'
                      }`}>
                        {st.kind === 'processed' ? 'procesado' : 'pendiente'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(msg.id); }}
                          disabled={deletingId === msg.id}
                          aria-label="Eliminar"
                          title="Eliminar mensaje"
                          className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggle(msg.id); }}
                          aria-label={isExpanded ? 'Ocultar' : 'Ver más'}
                          className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className={`${stripe} border-b border-zinc-100`}>
                      <td colSpan={5} className="px-6 py-4">
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap break-words leading-relaxed">
                          {full || <span className="text-zinc-400 italic">Sin contenido extraído.</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
                          {msg.transcriptionDuration != null && (
                            <span>Duración audio: {msg.transcriptionDuration}s</span>
                          )}
                          {msg.documentMethod && (
                            <span>Método extracción: {msg.documentMethod}</span>
                          )}
                          <span>Recibido: {new Date(msg.receivedAt).toLocaleString('es-AR')}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
