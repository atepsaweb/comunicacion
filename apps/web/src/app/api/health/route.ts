// Endpoint de salud del sistema (health check).
// n8n y el monitoreo del servidor llaman a este endpoint para verificar
// que la aplicación está corriendo y puede conectarse a la base de datos.
// Devuelve HTTP 200 si todo está bien, HTTP 503 si la DB no está disponible.
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function GET(): Promise<NextResponse> {
  let dbOk = false;
  try {
    // Ejecutar una consulta simple para verificar la conexión a la base de datos
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // db unreachable
  }

  const version = process.env.npm_package_version ?? 'unknown';

  return NextResponse.json({ ok: true, db: dbOk, version }, { status: dbOk ? 200 : 503 });
}
