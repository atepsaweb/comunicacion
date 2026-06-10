'use client';

// Componente que registra el Service Worker para habilitar la funcionalidad PWA.
// El Service Worker es un script que corre en segundo plano en el navegador y permite
// que la app funcione sin conexión a internet (cachea los recursos necesarios).
// Este componente no renderiza nada visible; su único trabajo es registrar el SW al cargar.
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    // Solo registrar si el navegador soporta Service Workers (todos los modernos lo hacen)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []); // El array vacío asegura que esto se ejecuta solo una vez al montar el componente
  return null;
}
