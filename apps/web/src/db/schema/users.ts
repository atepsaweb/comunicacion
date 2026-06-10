// Tabla de usuarios del sistema.
// Acá se guardan los datos de los 27+ miembros del Secretariado Nacional,
// más el Secretario de Prensa (Julián). Los usuarios se identifican principalmente
// por su número de teléfono, que es el mismo que usan para WhatsApp.
import { pgSchema, text, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { userRoleEnum } from './enums';

// Todos los datos del sistema viven dentro del schema 'app' de PostgreSQL,
// separado del schema público para mayor organización y seguridad.
export const appSchema = pgSchema('app');

export const users = appSchema.table('users', {
  // Identificador único generado automáticamente (formato UUIDv7, ordenable por tiempo)
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  // Nombre completo del secretario o vocal
  full_name: text('full_name').notNull(),
  // Email opcional (no requerido para el flujo de login por WhatsApp)
  email: text('email').unique(),
  // Número de teléfono en formato internacional E.164, ej: +5491145678901
  // Es la clave principal de identificación: WhatsApp lo usa para reconocer quién escribe
  phone_e164: text('phone_e164').notNull().unique(),
  // Rol del usuario en el sistema (ver enums.ts para los valores posibles)
  role: userRoleEnum('role').notNull().default('secretary'),
  // Cargo o función dentro del Secretariado (ej: "Secretario General", "Vocal Titular")
  position: text('position'),
  // Si está en false, el usuario no puede acceder al panel ni enviar mensajes
  is_active: boolean('is_active').notNull().default(true),
  // Notas internas sobre el usuario (solo visibles para el administrador)
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Si tiene fecha, el usuario fue desactivado (borrado lógico, no físico)
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
