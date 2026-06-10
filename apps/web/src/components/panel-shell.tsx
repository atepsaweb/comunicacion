'use client';

// Estructura visual principal del panel web.
// Este componente envuelve todas las páginas del panel y provee:
//   - En mobile: una barra superior (topbar) con botón para abrir el menú lateral
//   - En desktop: el menú lateral (sidebar) visible permanentemente
//   - El área de contenido principal donde se renderizan las páginas
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { SidebarNav } from './sidebar-nav';

interface Props {
  role: string;
  fullName: string;
  children: React.ReactNode;
}

export function PanelShell({ role, fullName, children }: Props) {
  // Controla si el drawer mobile del menú lateral está abierto o cerrado
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-100">

      {/* Topbar mobile — solo visible en <md */}
      <header
        className="md:hidden fixed inset-x-0 top-0 z-30 h-14 flex items-center px-4 gap-3 text-white shadow-sm"
        style={{ backgroundColor: '#2E3863' }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="-ml-2 p-2 rounded-md hover:bg-white/10 active:bg-white/20"
        >
          <Menu className="h-6 w-6" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-atepsa.png"
          alt="ATEPSA"
          className="h-7 w-auto object-contain"
        />
      </header>

      {/* Overlay para drawer mobile */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <SidebarNav
        role={role}
        fullName={fullName}
        open={open}
        onClose={() => setOpen(false)}
      />

      <main className="flex-1 overflow-auto min-h-0 pt-14 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
