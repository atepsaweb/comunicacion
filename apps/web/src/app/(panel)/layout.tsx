import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { SidebarNav } from '@/components/sidebar-nav';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-100">
      <SidebarNav role={session.user.role} fullName={session.user.full_name} />
      <main className="flex-1 overflow-auto min-h-0">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
