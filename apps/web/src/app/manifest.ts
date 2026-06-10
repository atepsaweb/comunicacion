// Manifest de la Progressive Web App (PWA).
// Este archivo le dice al navegador cómo comportarse cuando alguien "instala" el panel
// como una app en su celular (Android/iOS) usando "Agregar a pantalla de inicio".
// Así el panel se comporta como una app nativa: sin barra del navegador, con ícono propio, etc.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ATEPSA Reportes',
    short_name: 'ATEPSA',
    description: 'Panel del Secretariado Nacional',
    // La app abre directamente en el dashboard, no en la raíz
    start_url: '/dashboard',
    // Modo standalone: sin barra de navegador del sistema operativo
    display: 'standalone',
    background_color: '#0d2040',
    theme_color: '#2E3863',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
