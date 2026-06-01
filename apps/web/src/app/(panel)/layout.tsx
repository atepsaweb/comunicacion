import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { PanelShell } from '@/components/panel-shell';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <PanelShell role={session.user.role} fullName={session.user.full_name}>
      {children}
    </PanelShell>
  );
}
