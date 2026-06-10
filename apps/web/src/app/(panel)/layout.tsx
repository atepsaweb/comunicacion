// Layout de todas las páginas del panel.
// Verifica que el usuario tenga una sesión válida; si no, lo manda al login.
// Envuelve el contenido en PanelShell, que provee el sidebar y la barra mobile.
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { PanelShell } from '@/components/panel-shell';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // Si no hay sesión activa, redirigir al login inmediatamente
  if (!session) redirect('/login');

  return (
    <PanelShell role={session.user.role} fullName={session.user.full_name}>
      {children}
    </PanelShell>
  );
}
