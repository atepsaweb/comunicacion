// Base de afiliados/delegados de ATEPSA — no son usuarios del panel, sino
// personas que los secretarios mencionan en sus reportes (delegados de
// estaciones, técnicos de cada dependencia, etc.).
// Sirve principalmente como contexto para que la IA reconozca nombres y los
// asocie a su dependencia en lugar de tirarlos como menciones sueltas en el
// glosario.
import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { appSchema, users } from './users';

export const affiliates = appSchema.table('affiliates', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Datos identificatorios
  last_name: text('last_name').notNull(),
  first_name: text('first_name').notNull(),
  // Dependencia: estación / gerencia / sector dentro de EANA u otro organismo
  // (ej: "Bariloche", "CRT Ezeiza", "Gerencia de Seguridad").
  dependency: text('dependency'),
  // Cargo o función específica (ej: "Vocal Suplente", "Delegado", "Jefe de Torre")
  position: text('position'),
  // Identificadores opcionales (no usados en login)
  dni: text('dni'),
  legajo: text('legajo'),
  // Contacto opcional (no se usa para enviar mensajes — el secretariado tiene
  // su tabla `users` aparte para eso).
  email: text('email'),
  phone_e164: text('phone_e164'),
  // Notas internas del Secretariado
  notes: text('notes'),
  // Soft delete / activación
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export type Affiliate = typeof affiliates.$inferSelect;
export type NewAffiliate = typeof affiliates.$inferInsert;
