// Funciones utilitarias generales usadas en todo el proyecto.
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Combina clases de CSS de Tailwind de forma inteligente, resolviendo conflictos
// cuando se pasan múltiples clases que afectan la misma propiedad.
// Se usa en todos los componentes visuales para construir clases condicionalmente.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normaliza un número de teléfono argentino al formato E.164 (+549XXXXXXXXXX). */
export function normalizeArgPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  // +549XXXXXXXXXX → ya está bien
  if (/^549\d{10}$/.test(digits)) return `+${digits}`;

  // 54XXXXXXXXXX → le falta el 9 de celular
  if (/^54\d{10}$/.test(digits)) return `+549${digits.slice(2)}`;

  // 0XXXXXXXXXX → código de área con 0, sin 54
  if (/^0\d{10}$/.test(digits)) return `+549${digits.slice(1)}`;

  // XXXXXXXXXX → 10 dígitos sin prefijo
  if (/^\d{10}$/.test(digits)) return `+549${digits}`;

  return null;
}
