import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { EventActions } from './event-actions';
import type { ReminderConfig } from '@/lib/ai/prompts/parse-event';

const TYPE_LABEL: Record<string, string> = {
  personal:     'Personal',
  secretariat:  'Secretariado',
  mobilization: 'Movilización',
};

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: 'Pendiente de confirmación',
  proposed:             'Propuesto',
  confirmed:            'Confirmado',
  cancelled:            'Cancelado',
  done:                 'Finalizado',
};

const STATUS_COLOR: Record<string, string> = {
  pending_confirmation: 'bg-zinc-100 text-zinc-600',
  proposed:             'bg-amber-100 text-amber-700',
  confirmed:            'bg-green-100 text-green-700',
  cancelled:            'bg-red-100 text-red-700',
  done:                 'bg-zinc-100 text-zinc-500',
};

const TYPE_COLOR: Record<string, string> = {
  personal:     'bg-zinc-100 text-zinc-700',
  secretariat:  'bg-blue-100 text-blue-700',
  mobilization: 'bg-red-100 text-red-700',
};

const REMINDER_LABEL: [keyof ReminderConfig, string][] = [
  ['7d',      '7 días antes'],
  ['24h',     '24 horas antes'],
  ['12h',     '12 horas antes'],
  ['2h',      '2 horas antes'],
  ['followup', '¿Cómo salió? (al día siguiente)'],
];

function formatARTFull(iso: Date | null): string {
  if (!iso) return '—';
  return iso.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatARTDate(iso: Date | null): string {
  if (!iso) return '—';
  return iso.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface PageProps {
  params: { id: string };
}

export default async function EventoDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const [row] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      status: schema.events.status,
      starts_at: schema.events.starts_at,
      ends_at: schema.events.ends_at,
      all_day: schema.events.all_day,
      location: schema.events.location,
      description_md: schema.events.description_md,
      created_by: schema.events.created_by,
      requires_confirmation: schema.events.requires_confirmation,
      is_important: schema.events.is_important,
      reminder_config: schema.events.reminder_config,
      cancellation_reason: schema.events.cancellation_reason,
      cancelled_at: schema.events.cancelled_at,
      outcome_md: schema.events.outcome_md,
      created_at: schema.events.created_at,
      creator_name: schema.users.full_name,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.created_by, schema.users.id))
    .where(eq(schema.events.id, params.id))
    .limit(1);

  if (!row) notFound();

  const { id: userId, role } = session.user;
  const isOwner = row.created_by === userId;
  const isAdmin = role === 'press_admin';
  const isAdminOrExec = isAdmin || role === 'executive';
  const isPublic =
    row.type !== 'personal' &&
    (row.status === 'confirmed' || row.status === 'done' || row.status === 'proposed');

  if (!isOwner && !isAdminOrExec && !isPublic) notFound();

  const canEdit = (isOwner || isAdmin) && row.status !== 'cancelled' && row.status !== 'done';
  const canCancel = (isOwner || isAdminOrExec) && row.status !== 'cancelled' && row.status !== 'done';

  const remConf = row.reminder_config as ReminderConfig | null;
  const activeReminders = remConf
    ? REMINDER_LABEL.filter(([key]) => remConf[key])
    : [];

  const dateStr = row.all_day
    ? formatARTDate(row.starts_at)
    : formatARTFull(row.starts_at);

  const endStr = row.ends_at
    ? (row.all_day ? formatARTDate(row.ends_at) : formatARTFull(row.ends_at))
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Back */}
      <Link href="/agenda" className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
        ← Volver a la agenda
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[row.type] ?? 'bg-zinc-100 text-zinc-700'}`}>
            {TYPE_LABEL[row.type] ?? row.type}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[row.status] ?? 'bg-zinc-100 text-zinc-700'}`}>
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
          {row.is_important && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              Importante
            </span>
          )}
        </div>

        <h1 className="text-2xl font-bold text-zinc-900">{row.title}</h1>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
        <InfoRow label="Inicio" value={dateStr} />
        {endStr && <InfoRow label="Fin" value={endStr} />}
        {row.location && <InfoRow label="Lugar" value={row.location} />}
        <InfoRow label="Creado por" value={row.creator_name ?? '—'} />
        <InfoRow
          label="Creado el"
          value={formatARTFull(row.created_at)}
        />
      </div>

      {/* Descripción */}
      {row.description_md && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Descripción</p>
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">{row.description_md}</p>
        </div>
      )}

      {/* Recordatorios */}
      {activeReminders.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Recordatorios</p>
          <ul className="space-y-1">
            {activeReminders.map(([key, label]) => (
              <li key={key} className="text-sm text-zinc-700 flex items-center gap-1.5">
                <span className="text-green-500">✓</span> {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cancelación */}
      {row.status === 'cancelled' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1">
          <p className="text-xs font-medium text-red-600 uppercase tracking-wide">Cancelado</p>
          {row.cancelled_at && (
            <p className="text-sm text-red-700">{formatARTFull(row.cancelled_at)}</p>
          )}
          {row.cancellation_reason && (
            <p className="text-sm text-red-700">Motivo: {row.cancellation_reason}</p>
          )}
        </div>
      )}

      {/* Resultado */}
      {row.outcome_md && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Resultado</p>
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">{row.outcome_md}</p>
        </div>
      )}

      {/* Acciones */}
      <EventActions
        eventId={row.id}
        canEdit={canEdit}
        canCancel={canCancel}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <span className="text-sm text-zinc-400 w-24 shrink-0">{label}</span>
      <span className="text-sm text-zinc-800 capitalize-first">{value}</span>
    </div>
  );
}
