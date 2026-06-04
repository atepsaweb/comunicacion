// Endpoint de import masivo de afiliados desde CSV.
// Acepta:
//   - Content-Type: text/csv             → CSV puro
//   - Content-Type: application/json     → { rows: AffiliateInput[] }
// Columnas reconocidas (case-insensitive, con o sin tildes):
//   apellido | last_name
//   nombre   | first_name
//   dependencia | estacion | gerencia | sector | dependency
//   cargo    | posicion | position
//   dni
//   legajo
//   email
//   telefono | phone
//   notas    | notes
//
// Aplica upsert por (apellido + nombre + (legajo o dependencia)) — re-importar
// el mismo CSV no duplica filas.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { bulkUpsertAffiliates, type AffiliateInput } from '@/lib/affiliates';
import { logger } from '@/lib/logger';

const COLUMN_MAP: Record<string, keyof AffiliateInput> = {
  apellido: 'last_name',
  apellidos: 'last_name',
  'last name': 'last_name',
  last_name: 'last_name',
  surname: 'last_name',
  nombre: 'first_name',
  nombres: 'first_name',
  'first name': 'first_name',
  first_name: 'first_name',
  given_name: 'first_name',
  dependencia: 'dependency',
  dependency: 'dependency',
  estacion: 'dependency',
  estación: 'dependency',
  gerencia: 'dependency',
  sector: 'dependency',
  area: 'dependency',
  área: 'dependency',
  cargo: 'position',
  posicion: 'position',
  posición: 'position',
  position: 'position',
  rol: 'position',
  dni: 'dni',
  documento: 'dni',
  legajo: 'legajo',
  email: 'email',
  correo: 'email',
  telefono: 'phone_e164',
  teléfono: 'phone_e164',
  phone: 'phone_e164',
  whatsapp: 'phone_e164',
  notas: 'notes',
  notes: 'notes',
  observaciones: 'notes',
};

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Parser CSV mínimo con soporte de comillas dobles y comas dentro de comillas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function csvToRows(text: string): AffiliateInput[] {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return [];
  const headers = parsed[0].map(h => COLUMN_MAP[normalize(h)] ?? null);
  return parsed.slice(1).map(values => {
    const row: AffiliateInput = { last_name: '', first_name: '' };
    headers.forEach((key, i) => {
      if (!key) return;
      const v = values[i]?.trim() ?? '';
      if (v) (row as unknown as Record<string, string>)[key] = v;
    });
    return row;
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  let rows: AffiliateInput[] = [];

  try {
    if (contentType.includes('application/json')) {
      const body = await req.json() as { rows?: AffiliateInput[] };
      rows = body.rows ?? [];
    } else {
      const text = await req.text();
      rows = csvToRows(text);
    }
  } catch (err) {
    logger.error({ err }, 'affiliates import: failed to parse body');
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No se encontraron filas válidas' }, { status: 400 });
  }

  const result = await bulkUpsertAffiliates(rows, session.user.id);
  logger.info({ ...result, by: session.user.id }, 'affiliates imported');
  return NextResponse.json({ ok: true, ...result, total: rows.length });
}
