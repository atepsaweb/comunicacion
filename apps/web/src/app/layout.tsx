import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATEPSA — Panel Interno',
  description: 'Sistema de reporte semanal del Secretariado Nacional',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
