// Layout raíz de la aplicación Next.js.
// Este componente envuelve todas las páginas y define el HTML base de la aplicación.
// También configura los metadatos para PWA (Progressive Web App), que permite
// instalar el panel como una app en el celular desde el navegador.
import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

// Metadatos del sitio: título, descripción y configuración para iOS (para cuando se agrega a la pantalla de inicio)
export const metadata: Metadata = {
  title: 'ATEPSA — Panel Interno',
  description: 'Sistema de reporte semanal del Secretariado Nacional',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ATEPSA',
  },
  icons: {
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

// Configuración de la pantalla: adaptar al tamaño del dispositivo y usar el azul institucional
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2E3863',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {/* Registra el Service Worker para que la app funcione offline (PWA) */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
