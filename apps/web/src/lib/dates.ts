// Helpers de fecha compartidos por el sistema.
// Centraliza el cálculo de semana ISO y la resolución de "qué ciclo le toca a una fecha",
// que antes vivía duplicado en endpoints de ciclos. El módulo Agenda lo reutiliza para
// asignar cada evento a su semana sin guardar una FK rígida al ciclo.
//
// Zona horaria: el sistema opera en ART (America/Argentina/Buenos_Aires, UTC-3, sin DST).
// Las funciones de semana ISO trabajan sobre UTC, que es suficiente para la clave year+week.
import { and, eq, lte, gte } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';

/**
 * Devuelve el año y el número de semana ISO 8601 de una fecha.
 * La semana ISO empieza el lunes; la semana 1 es la que contiene el primer jueves del año.
 */
export function getISOWeekAndYear(date: Date): { year: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), isoWeek };
}

/**
 * Devuelve el lunes (00:00 UTC) de una semana ISO dada.
 */
export function isoWeekToMondayUTC(year: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;
}

/**
 * Clave de ciclo (year + isoWeek) que le corresponde a una fecha.
 * El módulo Agenda la usa para saber a qué semana pertenece un evento sin guardar FK al ciclo.
 * Es un alias semántico de getISOWeekAndYear pensado para fechas de eventos.
 */
export function cycleKeyForDate(date: Date): { year: number; isoWeek: number } {
  return getISOWeekAndYear(date);
}

/**
 * ¿El usuario está de licencia (o pausa) en una fecha dada?
 * True si existe una ausencia cuyo rango [starts_on, ends_on] cubre la fecha.
 * `dateISO` en formato YYYY-MM-DD (las ausencias se guardan por fecha, sin hora).
 */
export async function isUserOnLeave(userId: string, dateISO: string): Promise<boolean> {
  const absence = await db.query.absences.findFirst({
    where: and(
      eq(schema.absences.user_id, userId),
      lte(schema.absences.starts_on, dateISO),
      gte(schema.absences.ends_on, dateISO),
    ),
    columns: { id: true },
  });
  return absence !== undefined;
}
