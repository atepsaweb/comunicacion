'use client';

// Botón para descargar la matriz de cumplimiento en formato Excel (.xlsx).
// Al hacer clic, llama al endpoint /api/exports/cumplimiento.xlsx que genera el archivo
// y lo descarga directamente al dispositivo del usuario.
export function DownloadXlsxButton() {
  return (
    <a
      href="/api/exports/cumplimiento.xlsx"
      download
      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 text-white text-sm hover:bg-zinc-700 transition-colors"
    >
      Descargar Excel
    </a>
  );
}
