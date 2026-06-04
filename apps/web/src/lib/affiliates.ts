// Helpers para la base de afiliados/delegados.
// Provee un bloque de contexto compacto para inyectar al prompt de extract,
// para que la IA reconozca personas mencionadas por los secretarios.
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';

export type AffiliateInput = {
  last_name: string;
  first_name: string;
  dependency?: string | null;
  position?: string | null;
  dni?: string | null;
  legajo?: string | null;
  email?: string | null;
  phone_e164?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

function clean(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t === '' ? null : t;
}

/**
 * Upsert masivo. Identifica al afiliado por la tripleta
 * (apellido + nombre + dependencia o legajo cuando lo hay).
 * No es perfecto, pero alcanza para no duplicar en un re-import del mismo CSV.
 * Devuelve cuántos se insertaron y cuántos se actualizaron.
 */
export async function bulkUpsertAffiliates(
  rows: AffiliateInput[],
  createdByUserId?: string,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const last_name = clean(r.last_name);
    const first_name = clean(r.first_name);
    if (!last_name || !first_name) {
      skipped++;
      continue;
    }
    const dependency = clean(r.dependency);
    const legajo = clean(r.legajo);

    // Buscamos por apellido + nombre + legajo (si hay) o + dependencia (fallback)
    const existing = await db.query.affiliates.findFirst({
      where: legajo
        ? sql`lower(${affiliates.last_name}) = lower(${last_name})
              AND lower(${affiliates.first_name}) = lower(${first_name})
              AND ${affiliates.legajo} = ${legajo}`
        : sql`lower(${affiliates.last_name}) = lower(${last_name})
              AND lower(${affiliates.first_name}) = lower(${first_name})
              AND coalesce(lower(${affiliates.dependency}), '') = coalesce(lower(${dependency ?? ''}), '')`,
      columns: { id: true },
    });

    const values = {
      last_name,
      first_name,
      dependency,
      position: clean(r.position),
      dni: clean(r.dni),
      legajo,
      email: clean(r.email),
      phone_e164: clean(r.phone_e164),
      notes: clean(r.notes),
      is_active: r.is_active ?? true,
    };

    if (existing) {
      await db
        .update(affiliates)
        .set({ ...values, updated_at: new Date() })
        .where(eq(affiliates.id, existing.id));
      updated++;
    } else {
      await db.insert(affiliates).values({
        ...values,
        created_by: createdByUserId ?? null,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

/**
 * Devuelve un bloque compacto con todos los afiliados activos, ordenado por
 * apellido. Sirve para inyectar como contexto cacheable en el system prompt
 * de extract. El formato es deliberadamente económico en tokens:
 *
 *   - Cabral, Juan Carlos — Bariloche (Vocal)
 *   - García, Mariana — Gerencia de Seguridad
 */
export async function getAffiliatesContextBlock(): Promise<string> {
  const rows = await db.query.affiliates.findMany({
    where: eq(affiliates.is_active, true),
    columns: { last_name: true, first_name: true, dependency: true, position: true },
    orderBy: [asc(affiliates.last_name), asc(affiliates.first_name)],
  });
  if (rows.length === 0) return '';

  const lines = rows.map(r => {
    const dep = r.dependency ?? '';
    const pos = r.position ?? '';
    const tail = [dep, pos ? `(${pos})` : ''].filter(Boolean).join(' ');
    return `- ${r.last_name}, ${r.first_name}${tail ? ` — ${tail}` : ''}`;
  });

  return [
    'AFILIADOS Y DELEGADOS CONOCIDOS (referencia para identificar personas mencionadas):',
    ...lines,
  ].join('\n');
}
