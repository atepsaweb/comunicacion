import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { NuevoEventoForm } from './nuevo-evento-form';

export const metadata = { title: 'Nuevo evento — ATEPSA' };

export default async function NuevoEventoPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  // Ejecutivos no crean eventos
  if (session.user.role === 'executive') redirect('/agenda');

  return <NuevoEventoForm role={session.user.role} />;
}
