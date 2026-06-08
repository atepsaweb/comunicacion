import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { AgendaClient } from './agenda-client';

export const metadata = { title: 'Agenda — ATEPSA' };

export default async function AgendaPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <AgendaClient
      userId={session.user.id}
      role={session.user.role}
    />
  );
}
