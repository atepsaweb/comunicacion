/**
 * Seed de las claves de system_settings del módulo Agenda.
 * Correr desde apps/web: DATABASE_URL=... npx tsx scripts/seed-agenda-settings.ts
 * Idempotente: solo inserta claves que aún no existen (no pisa configuración editada).
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema/index.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// reminder_config por defecto según tipo de evento.
// Respeta el tope de 4 notificaciones por persona/evento (invitation + hasta 3 recordatorios).
// 'personal' no convoca a nadie: solo el followup al propio dueño.
const AGENDA_REMINDER_DEFAULTS = {
  personal:     { '7d': false, '24h': true,  '12h': false, '2h': false, followup: false },
  secretariat:  { '7d': false, '24h': true,  '12h': false, '2h': true,  followup: true },
  mobilization: { '7d': false, '24h': true,  '12h': true,  '2h': true,  followup: true },
};

const SEEDS: { key: string; value: unknown }[] = [
  // Defaults de recordatorios por tipo de evento.
  { key: 'agenda_reminder_defaults', value: AGENDA_REMINDER_DEFAULTS },
  // Tope de notificaciones por persona por evento (invitation + recordatorios). cancellation/followup exentos.
  { key: 'agenda_max_notifications_per_event', value: 4 },
  // Tope global de mensajes de agenda por persona por día (los is_important quedan exentos).
  { key: 'agenda_max_daily_per_user', value: 3 },
  // Si el feed iCal 'all' incluye también los eventos personales del usuario.
  { key: 'agenda_ical_include_personal_in_all', value: true },
];

async function main(): Promise<void> {
  console.log('Iniciando seed de settings de Agenda...');

  for (const seed of SEEDS) {
    const existing = await db.query.systemSettings.findFirst({
      where: eq(schema.systemSettings.key, seed.key),
      columns: { key: true },
    });

    if (existing) {
      console.log(`  ⏭  ${seed.key} — ya existe, omitiendo`);
      continue;
    }

    await db.insert(schema.systemSettings).values({
      key: seed.key,
      value: seed.value,
      updated_by: null,
    });

    console.log(`  ✓  ${seed.key} — creado`);
  }

  console.log('Seed completado.');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
