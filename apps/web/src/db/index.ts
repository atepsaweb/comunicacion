// Conexión a la base de datos PostgreSQL usando Drizzle ORM.
// Drizzle es la capa que permite escribir consultas en TypeScript de forma segura
// en lugar de SQL puro, con tipos verificados en tiempo de compilación.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

// En desarrollo, Next.js reinicia el módulo con cada cambio de código (hot reload).
// Sin este truco, crearía una nueva conexión a la base de datos en cada reinicio,
// agotando rápidamente el límite de conexiones de PostgreSQL.
// Guardamos el pool en la variable global para reutilizarlo entre reinicios.
const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Máximo de conexiones simultáneas abiertas al mismo tiempo
    max: 10,
    // Cerrar conexiones inactivas después de 30 segundos para liberar recursos
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
}

// Instancia de Drizzle lista para usar en todo el proyecto: import { db } from '@/db'
export const db = drizzle(pool, { schema });
export type DB = typeof db;
