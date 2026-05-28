/**
 * Seed script: carga los secretarios desde un CSV.
 *
 * Uso:
 *   DATABASE_URL=postgres://... pnpm db:seed /ruta/al/secretarios.csv
 *
 * Columnas esperadas en el CSV (con encabezado, separadas por comas):
 *   nombre_completo  — nombre y apellido (ej: "García, María")
 *   telefono         — número en cualquier formato argentino (ej: +5491145678901, 11-4567-8901)
 *   cargo            — título del cargo (ej: "Secretario General") — opcional
 *   rol              — secretary | executive | press_admin  (default: secretary)
 *   email            — dirección de mail — opcional
 *
 * El script es idempotente: si el número ya existe, actualiza nombre/cargo/rol.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as schema from '../src/db/schema';
import { normalizeArgPhone } from '../src/lib/utils';

const CSV_PATH = process.argv[2] ?? path.join(process.cwd(), 'secretarios.csv');

async function parseCsv(filePath: string): Promise<Record<string, string>[]> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  let lineNo = 0;

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (lineNo === 1) {
      headers = cols.map((h) => h.toLowerCase());
    } else {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
      rows.push(row);
    }
  }

  return rows;
}

function parseRole(raw: string): 'secretary' | 'executive' | 'press_admin' {
  const v = raw.trim().toLowerCase();
  if (v === 'executive') return 'executive';
  if (v === 'press_admin') return 'press_admin';
  return 'secretary';
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Archivo no encontrado: ${CSV_PATH}`);
    console.error('Uso: pnpm db:seed /ruta/secretarios.csv');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no configurada.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const rows = await parseCsv(CSV_PATH);
  console.log(`Leyendo ${rows.length} filas del CSV…`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const rawPhone =
      row['telefono'] ?? row['celular'] ?? row['phone'] ?? row['whatsapp'] ?? '';
    const rawName =
      row['nombre_completo'] ?? row['nombre'] ?? row['full_name'] ?? '';

    if (!rawPhone || !rawName) {
      console.warn(`  Fila sin teléfono o nombre: ${JSON.stringify(row)} — saltando.`);
      skipped++;
      continue;
    }

    const phone = normalizeArgPhone(rawPhone);
    if (!phone) {
      console.warn(`  Teléfono inválido: "${rawPhone}" — saltando.`);
      skipped++;
      continue;
    }

    const role = parseRole(row['rol'] ?? row['role'] ?? '');
    const cargo = (row['cargo'] ?? row['position'] ?? '').trim() || null;
    const email = (row['email'] ?? '').trim() || null;
    const name = rawName.trim();

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.phone_e164, phone))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.users)
        .set({ full_name: name, role, position: cargo, email, updated_at: new Date() })
        .where(eq(schema.users.phone_e164, phone));
      console.log(`  ✓ Actualizado: ${name} (${phone})`);
      updated++;
    } else {
      await db.insert(schema.users).values({
        id: uuidv7(),
        full_name: name,
        phone_e164: phone,
        role,
        position: cargo,
        email,
        is_active: true,
      });
      console.log(`  + Insertado:   ${name} (${phone})`);
      inserted++;
    }
  }

  await pool.end();

  console.log('\n--- Resumen ---');
  console.log(`  Insertados:  ${inserted}`);
  console.log(`  Actualizados: ${updated}`);
  console.log(`  Saltados:    ${skipped}`);
  console.log('Seed completado.');
}

main().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
