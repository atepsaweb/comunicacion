// Helpers para la base de afiliados/delegados.
// Provee un bloque de contexto compacto para inyectar al prompt de extract,
// para que la IA reconozca personas mencionadas por los secretarios.
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';

export type AffiliateInput = {
  last_name: string;
  first_name: string;
  aeropuerto?: string | null;
  organismo?: string | null;
  rama?: string | null;
  tipo?: string | null;
  vigencia?: string | null;  // ISO date string 'YYYY-MM-DD'
  // campos legacy
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
 * Upsert masivo. Identifica al afiliado por (apellido + nombre + aeropuerto).
 * Fallback: (apellido + nombre + dependency) para registros legacy.
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
    if (!last_name || !first_name) { skipped++; continue; }

    const aeropuerto = clean(r.aeropuerto) ?? clean(r.dependency);
    const legajo = clean(r.legajo);

    const existing = await db.query.affiliates.findFirst({
      where: legajo
        ? sql`lower(${affiliates.last_name}) = lower(${last_name})
              AND lower(${affiliates.first_name}) = lower(${first_name})
              AND ${affiliates.legajo} = ${legajo}`
        : sql`lower(${affiliates.last_name}) = lower(${last_name})
              AND lower(${affiliates.first_name}) = lower(${first_name})
              AND coalesce(lower(${affiliates.aeropuerto}), coalesce(lower(${affiliates.dependency}), ''))
                = coalesce(lower(${aeropuerto ?? ''}), '')`,
      columns: { id: true },
    });

    const values = {
      last_name,
      first_name,
      aeropuerto,
      organismo: clean(r.organismo),
      rama:      clean(r.rama),
      tipo:      clean(r.tipo),
      vigencia:  clean(r.vigencia),
      dependency: clean(r.dependency) ?? aeropuerto,
      position:  clean(r.position),
      dni:       clean(r.dni),
      legajo,
      email:     clean(r.email),
      phone_e164: clean(r.phone_e164),
      notes:     clean(r.notes),
      is_active: r.is_active ?? true,
    };

    if (existing) {
      await db
        .update(affiliates)
        .set({ ...values, updated_at: new Date() })
        .where(eq(affiliates.id, existing.id));
      updated++;
    } else {
      await db.insert(affiliates).values({ ...values, created_by: createdByUserId ?? null });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

/**
 * Bloque de contexto para el system prompt de extract.
 * Formato: - Corzo, Julio Cesar — La Rioja (EANA · CTA · Base)
 */
export async function getAffiliatesContextBlock(): Promise<string> {
  const rows = await db.query.affiliates.findMany({
    where: eq(affiliates.is_active, true),
    columns: {
      last_name: true, first_name: true,
      aeropuerto: true, dependency: true,
      organismo: true, rama: true, tipo: true, position: true,
    },
    orderBy: [asc(affiliates.last_name), asc(affiliates.first_name)],
  });
  if (rows.length === 0) return '';

  const lines = rows.map(r => {
    const airport = r.aeropuerto ?? r.dependency ?? '';
    const parts = [
      r.organismo,
      r.rama,
      r.tipo ? `Delegado ${r.tipo}` : r.position,
    ].filter(Boolean).join(' · ');
    const tail = [airport, parts ? `(${parts})` : ''].filter(Boolean).join(' ');
    return `- ${r.last_name}, ${r.first_name}${tail ? ` — ${tail}` : ''}`;
  });

  return [
    'AFILIADOS Y DELEGADOS CONOCIDOS (referencia para identificar personas mencionadas):',
    ...lines,
  ].join('\n');
}
