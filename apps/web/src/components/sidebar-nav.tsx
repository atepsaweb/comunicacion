'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard, FileText, CalendarOff, LogOut, Settings,
  Users, BarChart2, TrendingUp, ShieldCheck, Activity,
  MessageSquare, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
  dividerBefore?: boolean; // línea separadora sutil antes de este item
}

const navItems: NavItem[] = [
  { label: 'Dashboard',          href: '/dashboard',                  icon: LayoutDashboard },
  { label: 'Mis mensajes',       href: '/mis-mensajes',               icon: FileText,       roles: ['secretary', 'executive', 'press_admin'] },
  { label: 'Mis reportes',       href: '/reportes',                   icon: FileText,       roles: ['secretary', 'executive', 'press_admin'] },
  { label: 'Ausencias',          href: '/ausencias',                  icon: CalendarOff },
  { label: 'Revisión',           href: '/revision',                   icon: FileText,       roles: ['press_admin'] },
  { label: 'Cumplimiento',       href: '/ejecutivo/cumplimiento',     icon: BarChart2,      roles: ['executive', 'press_admin'] },
  { label: 'Estadísticas',       href: '/ejecutivo/estadisticas',     icon: TrendingUp,     roles: ['executive', 'press_admin'] },
  { label: 'Usuarios',           href: '/admin/usuarios',             icon: Users,          roles: ['press_admin'],  dividerBefore: true },
  { label: 'Ausencias (Admin)',  href: '/admin/ausencias',            icon: ShieldCheck,    roles: ['press_admin'] },
  { label: 'Prompts IA',         href: '/admin/prompts',              icon: MessageSquare,  roles: ['press_admin'] },
  { label: 'Glosario IA',        href: '/admin/glosario',             icon: BookOpen,       roles: ['press_admin'] },
  { label: 'Logs IA',            href: '/admin/logs/ia',              icon: Activity,       roles: ['press_admin'] },
  { label: 'Configuración',      href: '/admin/settings',             icon: Settings,       roles: ['press_admin'] },
  // Logs Auditoría: tabla sin datos aún — oculto del sidebar
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
    <aside className="w-56 flex flex-col shrink-0" style={{ backgroundColor: '#2E3863' }}>

      {/* Logo + usuario */}
      <div className="px-5 py-5 border-b border-white/10">
        <Image
          src="/logo-atepsa.png"
          alt="ATEPSA"
          width={120}
          height={32}
          className="object-contain"
          priority
        />
        <p className="text-xs text-white/50 mt-2 truncate">{fullName}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <div key={item.href}>
              {item.dividerBefore && (
                <div className="my-2 border-t border-white/10" />
              )}
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  active
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/65 hover:text-white hover:bg-white/8',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            </div>
          );
        })}

        {/* Cerrar sesión — debajo de Configuración */}
        <div className="mt-2 border-t border-white/10 pt-2">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-white/65 hover:text-white hover:bg-white/8 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </div>
      </nav>

    </aside>
  );
}
