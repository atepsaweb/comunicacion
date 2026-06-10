// Página de edición de un evento existente.
// Carga el evento en el server, valida permisos y delega en el form client.
import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import type { ReminderConfig } from '@/lib/ai/prompts/parse-event';
import { EditarEventoForm } from './editar-evento-form';

const ART_TZ = 'America/Argentina/Buenos_Aires';

function toARTDateISO(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: ART_TZ });
}

function toARTTime(date: Date): string {
  return date.toLocaleTimeString('es-AR', {
    timeZone: ART_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default async function EditarEventoPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const row = await db.query.events.findFirst({
    where: eq(schema.events.id, params.id),
    columns: {
      id: true,
      title: true,
      type: true,
      status: true,
      starts_at: true,
      ends_at: true,
      all_day: true,
      location: true,
      description_md: true,
      created_by: true,
      reminder_config: true,
    },
  });

  if (!row) notFound();

  const { id: userId, role } = session.user;
  const isOwner = row.created_by === userId;
  const isAdmin = role === 'press_admin';

  // Mismas reglas que el PATCH: solo creador o admin, y no cancelado/finalizado
  if (!isOwner && !isAdmin) notFound();
  if (row.status === 'cancelled' || row.status === 'done') redirect(`/agenda/${row.id}`);

  return (
    <EditarEventoForm
      eventId={row.id}
      eventType={row.type}
      initial={{
        title: row.title,
        allDay: row.all_day,
        date: toARTDateISO(row.starts_at),
        time: row.all_day ? '09:00' : toARTTime(row.starts_at),
        endDate: row.ends_at ? toARTDateISO(row.ends_at) : '',
        endTime: row.ends_at && !row.all_day ? toARTTime(row.ends_at) : '',
        location: row.location ?? '',
        description: row.description_md ?? '',
        reminders: (row.reminder_config ?? {}) as ReminderConfig,
      }}
    />
  );
}
