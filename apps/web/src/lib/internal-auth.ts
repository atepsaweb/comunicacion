// Autenticación de los endpoints internos que consume n8n (el orquestador de flujos).
// Los endpoints /api/internal/* no los usa el navegador sino n8n, que corre en el mismo servidor.
// Para que nadie externo pueda llamarlos, se protegen con un secret compartido.
import { NextRequest } from 'next/server';

/**
 * Verifica que el request tenga el header "Authorization: Bearer <INTERNAL_API_SECRET>".
 * Retorna true si el secret coincide con la variable de entorno, false en cualquier otro caso.
 * Si la variable de entorno no está configurada, siempre rechaza (falla seguro).
 */
export function validateInternalSecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  // Si no está configurado el secret, rechazamos todo para no exponer los endpoints
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const spaceIdx = auth.indexOf(' ');
  if (spaceIdx === -1) return false;
  // El header debe tener formato "Bearer <token>"
  const scheme = auth.slice(0, spaceIdx);
  const token = auth.slice(spaceIdx + 1);
  return scheme === 'Bearer' && token === secret;
}
