'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LayoutDashboard, FileText, CalendarOff, LogOut, Settings, Users, BarChart2, TrendingUp, ShieldCheck, Activity, ClipboardList, MessageSquare, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Mis mensajes', href: '/mis-mensajes', icon: FileText, roles: ['secretary', 'executive', 'press_admin'] },
  { label: 'Mis reportes', href: '/reportes', icon: FileText, roles: ['secretary', 'executive', 'press_admin'] },
  { label: 'Ausencias', href: '/ausencias', icon: CalendarOff },
  { label: 'Revisión', href: '/revision', icon: FileText, roles: ['press_admin'] },
  { label: 'Cumplimiento', href: '/ejecutivo/cumplimiento', icon: BarChart2, roles: ['executive', 'press_admin'] },
  { label: 'Estadísticas', href: '/ejecutivo/estadisticas', icon: TrendingUp, roles: ['executive', 'press_admin'] },
  { label: 'Usuarios', href: '/admin/usuarios', icon: Users, roles: ['press_admin'] },
  { label: 'Ausencias (Admin)', href: '/admin/ausencias', icon: ShieldCheck, roles: ['press_admin'] },
  { label: 'Prompts IA', href: '/admin/prompts', icon: MessageSquare, roles: ['press_admin'] },
  { label: 'Glosario IA', href: '/admin/glosario', icon: BookOpen, roles: ['press_admin'] },
  { label: 'Logs IA', href: '/admin/logs/ia', icon: Activity, roles: ['press_admin'] },
  { label: 'Logs Auditoría', href: '/admin/logs/audit', icon: ClipboardList, roles: ['press_admin'] },
  { label: 'Configuración', href: '/admin/settings', icon: Settings, roles: ['press_admin'] },
];

interface Props {
  role: string;
  fullName: string;
}

export function SidebarNav({ role, fullName }: Props) {
  const pathname = usePathname();

  const visible = navItems.filter(
    (item) => !item.roles || item.roles.includes(role),
  );

  return (
    <aside className="w-56 flex flex-col bg-zinc-900 text-zinc-100 shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-zinc-700">
        <span className="text-base font-bold tracking-tight">ATEPSA</span>
        <p className="text-xs text-zinc-400 mt-0.5 truncate">{fullName}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-zinc-700 text-white font-medium'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-zinc-700">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
