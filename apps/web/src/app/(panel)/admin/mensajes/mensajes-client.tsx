'use client';

// Vista en vivo de mensajes entrantes con auto-refresh cada 10s.
// Recibe los rows del server component y los re-renderiza con expand inline
// para ver el contenido completo de cada mensaje (transcripción / extracción).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FileType2,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  RefreshCw,
  X,
} from 'lucide-react';

const REFRESH_INTERVAL_MS = 10_000;

export type MensajeRow = {
  id: string;
  kind: 'text' | 'audio' | 'other';
  mimeType: string | null;
  textContent: string | null;
  receivedAt: string;
  processedAt: string | null;
  discardedAt: string | null;
  discardReason: string | null;
  fromPhoneE164: string;
  provider: string;
  transcriptionText: string | null;
  transcriptionDuration: number | null;
  documentText: string | null;
  documentMethod: string | null;
  userFullName: string | null;
  userPosition: string | null;
  userId: string | null;
  audioPath: string | null;
  documentPath: string | null;
};

export type BotMessageRow = {
  id: string;
  userId: string | null;
  body: string;
  sentAt: string;
  deliveryStatus: string;
};

type KindBadge = {
  label: string;
  classes: string;
  Icon: React.ElementType;
};

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

function mediaUrl(id: string): string {
  return `/api/media/message/${id}`;
}

function BadgeElement({
  msg,
  badge,
  onOpenLightbox,
}: {
  msg: MensajeRow;
  badge: KindBadge;
  onOpenLightbox: (url: string) => void;
}) {
  const Icon = badge.Icon;
  const base = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.classes}`;

  if (msg.mimeType?.startsWith('image/') && msg.documentPath) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenLightbox(mediaUrl(msg.id)); }}
        className={`${base} cursor-pointer hover:opacity-75`}
      >
        <Icon className="h-3 w-3" />
        {badge.label}
      </button>
    );
  }

  const isDoc =
    (msg.mimeType === 'application/pdf' ||
      msg.mimeType?.includes('wordprocessingml') ||
      msg.mimeType === 'application/msword') &&
    msg.documentPath;

  if (isDoc) {
    return (
      <a
        href={mediaUrl(msg.id)}
        download
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${base} cursor-pointer hover:opacity-75`}
      >
        <Icon className="h-3 w-3" />
        {badge.label}
        <Download className="h-2.5 w-2.5 opacity-50" />
      </a>
    );
  }

  return (
    <span className={base}>
      <Icon className="h-3 w-3" />
      {badge.label}
    </span>
  );
}

// Asigna las repreguntas del bot a su mensaje entrante "padre".
// Estrategia: tomamos todos los mensajes del bot con purpose=followup_question
// enviados al mismo usuario, DESPUÉS de receivedAt del mensaje y ANTES del
// próximo mensaje entrante de ese usuario (o dentro de 6h si no hay ninguno).
// allInbound debe estar ordenado desc por receivedAt (como viene de la query).
function getReplies(
  msg: MensajeRow,
  allInbound: readonly MensajeRow[],
  botMsgs: BotMessageRow[],
): BotMessageRow[] {
  if (!msg.userId) return [];
  const msgTime = new Date(msg.receivedAt).getTime();
  const BURST_MS = 6 * 60 * 60 * 1000; // ventana de 6 horas (igual que assess-completeness)

  // Buscar el próximo mensaje del mismo usuario en el tiempo (índice menor = más reciente)
  const idx = allInbound.findIndex(m => m.id === msg.id);
  let upperBound = msgTime + BURST_MS;
  for (let i = idx - 1; i >= 0; i--) {
    if (allInbound[i].userId === msg.userId) {
      upperBound = new Date(allInbound[i].receivedAt).getTime();
      break;
    }
  }

  return botMsgs.filter(b => {
    const t = new Date(b.sentAt).getTime();
    return b.userId === msg.userId && t > msgTime && t < upperBound;
  });
}

type Status =
  | { kind: 'discarded'; reason: string }
  | { kind: 'processed' }
  | { kind: 'pending' }
  | { kind: 'unregistered' };

function statusOf(msg: MensajeRow): Status {
  if (msg.discardedAt) {
    return { kind: 'discarded', reason: msg.discardReason ?? 'descartado' };
  }
  if (!msg.userFullName) return { kind: 'unregistered' };
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

function preview(msg: MensajeRow, maxChars = 100): string {
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

function secondsAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

interface Props {
  initialMessages: MensajeRow[];
  botMessages: BotMessageRow[];
}

export function MensajesLiveClient({ initialMessages, botMessages }: Props) {
  const router = useRouter();
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [, force] = useState(0);
  const inflight = useRef(false);

  const visible = useMemo(
    () => showDiscarded ? initialMessages : initialMessages.filter(m => !m.discardedAt),
    [initialMessages, showDiscarded],
  );

  // Auto-refresh cada 10s. Marca lastRefresh al disparar el router.refresh.
  useEffect(() => {
    const id = setInterval(() => {
      if (inflight.current) return;
      inflight.current = true;
      router.refresh();
      setLastRefresh(new Date());
      // Pequeño delay para evitar reentrancia inmediata
      setTimeout(() => { inflight.current = false; }, 500);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  // Tick cada segundo para actualizar "hace X segundos"
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

  function refreshNow() {
    router.refresh();
    setLastRefresh(new Date());
  }

  const secs = secondsAgo(lastRefresh.toISOString());

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Mensajes en vivo</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Últimos 100 mensajes recibidos por WhatsApp. Refresca automáticamente cada 10 s.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDiscarded}
              onChange={e => setShowDiscarded(e.target.checked)}
              className="rounded"
            />
            Mostrar descartados
          </label>
          <button
            onClick={refreshNow}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizado hace {secs}s
          </button>
        </div>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white py-10 text-center text-sm text-zinc-400">
            Todavía no llegaron mensajes.
          </div>
        ) : (
          visible.map(msg => {
            const isExpanded = expanded.has(msg.id);
            const badge = kindBadge(msg.kind, msg.mimeType);
            const { date, time } = formatDateTime(msg.receivedAt);
            const st = statusOf(msg);
            const author = msg.userFullName ?? msg.fromPhoneE164;
            const text = preview(msg);
            const full = fullContent(msg);
            const isImage = msg.mimeType?.startsWith('image/') && msg.documentPath;
            const replies = getReplies(msg, initialMessages, botMessages);
            return (
              <div
                key={msg.id}
                className={`rounded-lg border bg-white ${msg.discardedAt ? 'opacity-60 border-zinc-200' : 'border-zinc-200'}`}
              >
                <button
                  onClick={() => toggle(msg.id)}
                  className="w-full text-left px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium text-zinc-700 tabular-nums">
                      {date} · {time}
                    </span>
                    <BadgeElement msg={msg} badge={badge} onOpenLightbox={setLightboxUrl} />
                  </div>
                  <p className="text-sm font-medium text-zinc-900 truncate">{author}</p>
                  {msg.userPosition && (
                    <p className="text-[11px] text-zinc-500 truncate">{msg.userPosition}</p>
                  )}
                  {isImage ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLightboxUrl(mediaUrl(msg.id)); }}
                      className="mt-1.5 block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaUrl(msg.id)}
                        alt="Imagen"
                        className="h-14 w-auto max-w-[140px] rounded border border-zinc-200 object-cover"
                      />
                    </button>
                  ) : text ? (
                    <p className="text-xs text-zinc-600 mt-1.5 line-clamp-2">{text}</p>
                  ) : (
                    <p className="text-xs text-zinc-400 italic mt-1.5">
                      {st.kind === 'pending' ? 'Procesando…' : st.kind === 'discarded' ? `Descartado (${st.reason})` : st.kind === 'unregistered' ? 'Número no registrado' : '—'}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {isExpanded ? 'Ocultar' : 'Ver más'}
                    </span>
                    {replies.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        <Bot className="h-2.5 w-2.5" />
                        {replies.length} repregunta{replies.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-zinc-100 pt-3">
                    {msg.kind === 'audio' && msg.audioPath && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio controls src={mediaUrl(msg.id)} className="w-full mb-2" />
                    )}
                    {isImage && (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(mediaUrl(msg.id))}
                        className="block mb-2"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaUrl(msg.id)}
                          alt="Imagen"
                          className="max-h-[240px] w-auto rounded border border-zinc-200"
                        />
                      </button>
                    )}
                    <div className="text-sm text-zinc-800 whitespace-pre-wrap break-words">
                      {full || <span className="text-zinc-400 italic">Sin contenido extraído.</span>}
                    </div>
                    {replies.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-100">
                        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                          Repreguntas del bot
                        </p>
                        <div className="space-y-3">
                          {replies.map(r => (
                            <div key={r.id} className="flex items-start gap-2">
                              <div className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Bot className="h-3 w-3 text-emerald-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-zinc-400 mb-0.5">
                                  {new Date(r.sentAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                  {' · '}
                                  {r.deliveryStatus === 'read' ? 'leída' : r.deliveryStatus === 'delivered' ? 'entregada' : 'enviada'}
                                </p>
                                <p className="text-sm text-zinc-700 leading-snug">{r.body}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 text-[11px] text-zinc-500 space-y-0.5">
                      <p>De: <span className="font-mono">{msg.fromPhoneE164}</span></p>
                      {msg.transcriptionDuration != null && (
                        <p>Duración audio: {msg.transcriptionDuration}s</p>
                      )}
                      {msg.documentMethod && (
                        <p>Método extracción: {msg.documentMethod}</p>
                      )}
                      <p>Recibido: {new Date(msg.receivedAt).toLocaleString('es-AR')}</p>
                    </div>
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
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[14rem]">Autor</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[7rem]">Tipo</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600">Contenido</th>
              <th className="px-3 py-2.5 font-medium text-zinc-600 w-[8.5rem]">Estado</th>
              <th className="px-3 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-zinc-400 text-sm">
                  Todavía no llegaron mensajes.
                </td>
              </tr>
            )}
            {visible.map((msg, i) => {
              const isExpanded = expanded.has(msg.id);
              const badge = kindBadge(msg.kind, msg.mimeType);
              const { date, time } = formatDateTime(msg.receivedAt);
              const st = statusOf(msg);
              const author = msg.userFullName ?? msg.fromPhoneE164;
              const text = preview(msg);
              const full = fullContent(msg);
              const isImage = msg.mimeType?.startsWith('image/') && msg.documentPath;
              const replies = getReplies(msg, initialMessages, botMessages);
              const stripe = i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50';
              const dim = msg.discardedAt ? 'opacity-55' : '';
              return (
                <Fragment key={msg.id}>
                  <tr
                    onClick={() => toggle(msg.id)}
                    className={`${stripe} ${dim} cursor-pointer hover:bg-zinc-50 transition-colors`}
                  >
                    <td className="px-3 py-2.5 text-xs text-zinc-600 tabular-nums whitespace-nowrap align-top">
                      <div className="font-medium text-zinc-700">{time}</div>
                      <div className="text-zinc-400">{date}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-zinc-800 truncate">{author}</div>
                      {msg.userPosition && (
                        <div className="text-[11px] text-zinc-500 truncate">{msg.userPosition}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <BadgeElement msg={msg} badge={badge} onOpenLightbox={setLightboxUrl} />
                    </td>
                    <td className="px-3 py-2.5 align-top text-zinc-700 text-sm">
                      {isImage ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setLightboxUrl(mediaUrl(msg.id)); }}
                          className="block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={mediaUrl(msg.id)}
                            alt="Imagen"
                            className="h-12 w-auto max-w-[150px] rounded border border-zinc-200 object-cover"
                          />
                        </button>
                      ) : text ? (
                        <span className="line-clamp-2">{text}</span>
                      ) : (
                        <span className="text-zinc-400 italic text-xs">
                          {st.kind === 'pending' ? 'Procesando…' : st.kind === 'discarded' ? `Descartado (${st.reason})` : st.kind === 'unregistered' ? 'Número no registrado' : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          st.kind === 'processed'
                            ? 'bg-green-100 text-green-700'
                            : st.kind === 'pending'
                              ? 'bg-zinc-100 text-zinc-600'
                              : st.kind === 'discarded'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {st.kind === 'processed' ? 'procesado' : st.kind === 'pending' ? 'pendiente' : st.kind === 'discarded' ? 'descartado' : 'sin registrar'}
                      </span>
                      {replies.length > 0 && (
                        <span className="mt-1 flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                          <Bot className="h-2.5 w-2.5" />
                          {replies.length} repregunta{replies.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(msg.id); }}
                        className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                        aria-label={isExpanded ? 'Ocultar' : 'Ver más'}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className={`${stripe} ${dim} border-b border-zinc-100`}>
                      <td colSpan={6} className="px-6 py-4">
                        {msg.kind === 'audio' && msg.audioPath && (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <audio controls src={mediaUrl(msg.id)} className="w-full mb-3" />
                        )}
                        {isImage && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(mediaUrl(msg.id))}
                            className="block mb-3"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={mediaUrl(msg.id)}
                              alt="Imagen"
                              className="max-h-[280px] w-auto rounded border border-zinc-200"
                            />
                          </button>
                        )}
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap break-words leading-relaxed">
                          {full || <span className="text-zinc-400 italic">Sin contenido extraído.</span>}
                        </div>
                        {replies.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-zinc-100">
                            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                              Repreguntas del bot
                            </p>
                            <div className="space-y-3">
                              {replies.map(r => (
                                <div key={r.id} className="flex items-start gap-2">
                                  <div className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                    <Bot className="h-3 w-3 text-emerald-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-zinc-400 mb-0.5">
                                      {new Date(r.sentAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                      {' · '}
                                      {r.deliveryStatus === 'read' ? 'leída' : r.deliveryStatus === 'delivered' ? 'entregada' : 'enviada'}
                                    </p>
                                    <p className="text-sm text-zinc-700 leading-snug">{r.body}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
                          <span>De: <span className="font-mono">{msg.fromPhoneE164}</span></span>
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
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Imagen completa"
            className="max-h-[90vh] max-w-[90vw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
