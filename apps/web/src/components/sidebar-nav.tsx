'use client';

// Componente de navegación lateral (sidebar) del panel.
// Muestra los ítems de menú filtrados según el rol del usuario:
// los secretarios ven menos opciones que el administrador de prensa.
// En mobile funciona como un drawer (panel que aparece desde la izquierda).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect } from 'react';
import {
  LayoutDashboard, FileText, CalendarOff, CalendarDays, LogOut, Settings,
  Users, BarChart2, TrendingUp, ShieldCheck, Activity,
  MessageSquare, BookOpen, X, Inbox, ClipboardList, CalendarCheck2,
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
  { label: 'Agenda',             href: '/agenda',                     icon: CalendarDays },
  { label: 'Propuestas',        href: '/agenda/propuestas',          icon: ClipboardList,  roles: ['executive', 'press_admin'] },
  { label: 'Mi calendario',     href: '/mi-calendario',              icon: CalendarCheck2 },
  { label: 'Revisión',           href: '/revision',                   icon: FileText,       roles: ['press_admin'] },
  { label: 'Cumplimiento',       href: '/ejecutivo/cumplimiento',     icon: BarChart2,      roles: ['executive', 'press_admin'] },
  { label: 'Estadísticas',       href: '/ejecutivo/estadisticas',     icon: TrendingUp,     roles: ['executive', 'press_admin'] },
  { label: 'Mensajes (live)',    href: '/admin/mensajes',             icon: Inbox,          roles: ['press_admin'],  dividerBefore: true },
  { label: 'Usuarios',           href: '/admin/usuarios',             icon: Users,          roles: ['press_admin'] },
  { label: 'Afiliados',          href: '/admin/afiliados',            icon: Users,          roles: ['press_admin'] },
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
  open?: boolean;
  onClose?: () => void;
}

export function SidebarNav({ role, fullName, open = false, onClose }: Props) {
  // Ruta actual para marcar el ítem activo con resaltado
  const pathname = usePathname();

  // Filtrar ítems según el rol: si un ítem tiene roles definidos, solo se muestra a esos roles
  const visible = navItems.filter(
    (item) => !item.roles || item.roles.includes(role),
  );

  // Bloquea el scroll del body mientras el drawer mobile esté abierto
  // para evitar que el fondo se mueva mientras el menú está visible
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.body.style.overflow;
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [open]);

  return (
    <aside
      className={cn(
        'w-64 md:w-56 flex flex-col shrink-0',
        // Mobile: drawer off-canvas
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        // Desktop: estático, sin transform, sin shadow
        'md:static md:translate-x-0 md:shadow-none',
      )}
      style={{ backgroundColor: '#2E3863' }}
      aria-hidden={!open ? 'true' : undefined}
    >

      {/* Logo + usuario + cerrar (solo mobile) */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-atepsa.png"
            alt="ATEPSA"
            className="h-8 w-auto object-contain"
          />
          <p className="text-xs text-white/50 mt-2 truncate">{fullName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar menú"
          className="md:hidden -mr-2 p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
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
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-md text-sm transition-colors',
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
            className="flex items-center gap-3 w-full px-3 py-2.5 md:py-2 rounded-md text-sm text-white/65 hover:text-white hover:bg-white/8 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </div>
      </nav>

    </aside>
  );
}
