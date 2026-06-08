-- Migración 0004: módulo Agenda (Fase A1)
-- Aplicar en el VPS:  psql $DATABASE_URL -f 0004_agenda_module.sql
--
-- Escrita a mano (idempotente) en el estilo de 0002/0003: el snapshot de drizzle-kit
-- está desincronizado con el schema real (greeting, document_extractions, source_message_id
-- no figuran en los snapshots), así que `drizzle-kit generate` produciría un diff espurio.
-- Esta migración crea los enums y tablas del módulo Agenda y agrega valores a 3 enums existentes.
--
-- Nota: los ALTER TYPE ... ADD VALUE corren en autocommit (psql -f). No envolver el archivo
-- en una transacción explícita.

-- ─── 1. Nuevos valores en enums existentes (idempotente) ──────────────────────
ALTER TYPE "public"."message_intent" ADD VALUE IF NOT EXISTS 'event_create';
ALTER TYPE "public"."message_intent" ADD VALUE IF NOT EXISTS 'event_confirmation_reply';

ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_invitation';
ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_reminder';
ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_followup';
ALTER TYPE "public"."outbound_purpose" ADD VALUE IF NOT EXISTS 'event_proposal';

ALTER TYPE "public"."ai_purpose" ADD VALUE IF NOT EXISTS 'parse_event';

-- ─── 2. Enums nuevos del módulo ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "public"."event_type" AS ENUM('personal', 'secretariat', 'mobilization');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."event_status" AS ENUM('pending_confirmation', 'proposed', 'confirmed', 'cancelled', 'done');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."attendee_status" AS ENUM('invited', 'going', 'not_going', 'maybe', 'no_response', 'on_leave');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."event_notification_kind" AS ENUM('invitation', 'reminder_7d', 'reminder_24h', 'reminder_12h', 'reminder_2h', 'followup', 'cancellation');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."event_notification_status" AS ENUM('pending', 'sent', 'skipped', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ical_scope" AS ENUM('all', 'secretariat', 'personal');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── 3. Tablas ────────────────────────────────────────────────────────────────

-- events: el evento en sí. Sin FK al ciclo (se calcula por fecha en lib/dates.ts).
CREATE TABLE IF NOT EXISTS "app"."events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description_md" text,
  "type" "public"."event_type" NOT NULL,
  "status" "public"."event_status" DEFAULT 'pending_confirmation' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone,
  "all_day" boolean DEFAULT false NOT NULL,
  "location" text,
  "created_by" uuid NOT NULL REFERENCES "app"."users"("id") ON DELETE restrict,
  "approved_by" uuid REFERENCES "app"."users"("id") ON DELETE restrict,
  "approved_at" timestamp with time zone,
  "requires_confirmation" boolean DEFAULT false NOT NULL,
  "is_important" boolean DEFAULT false NOT NULL,
  "reminder_config" jsonb NOT NULL,
  "outcome_md" text,
  "outcome_reported_at" timestamp with time zone,
  "outcome_report_item_id" uuid REFERENCES "app"."report_items"("id") ON DELETE set null,
  "cancellation_reason" text,
  "cancelled_by" uuid REFERENCES "app"."users"("id") ON DELETE restrict,
  "cancelled_at" timestamp with time zone,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_events_starts_at"       ON "app"."events" ("starts_at");
CREATE INDEX IF NOT EXISTS "idx_events_type"            ON "app"."events" ("type");
CREATE INDEX IF NOT EXISTS "idx_events_status"          ON "app"."events" ("status");
CREATE INDEX IF NOT EXISTS "idx_events_created_by"      ON "app"."events" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_events_status_starts"   ON "app"."events" ("status", "starts_at");

-- event_attendees: convocados y su estado de asistencia.
CREATE TABLE IF NOT EXISTS "app"."event_attendees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "app"."events"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "app"."users"("id") ON DELETE restrict,
  "status" "public"."attendee_status" DEFAULT 'invited' NOT NULL,
  "responded_at" timestamp with time zone,
  "response_source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_attendees_event_user_unique" UNIQUE("event_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_event_attendees_event_id" ON "app"."event_attendees" ("event_id");
CREATE INDEX IF NOT EXISTS "idx_event_attendees_user_id"  ON "app"."event_attendees" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_event_attendees_status"   ON "app"."event_attendees" ("status");

-- event_notifications: cola pre-computada + log de notificaciones.
CREATE TABLE IF NOT EXISTS "app"."event_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "app"."events"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "app"."users"("id") ON DELETE restrict,
  "kind" "public"."event_notification_kind" NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" "public"."event_notification_status" DEFAULT 'pending' NOT NULL,
  "sent_at" timestamp with time zone,
  "skip_reason" text,
  "outbound_message_id" uuid REFERENCES "app"."outbound_messages"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_notifications_event_user_kind_unique" UNIQUE("event_id", "user_id", "kind")
);

CREATE INDEX IF NOT EXISTS "idx_event_notifications_status_sched" ON "app"."event_notifications" ("status", "scheduled_for");
CREATE INDEX IF NOT EXISTS "idx_event_notifications_event_id"     ON "app"."event_notifications" ("event_id");
CREATE INDEX IF NOT EXISTS "idx_event_notifications_user_id"      ON "app"."event_notifications" ("user_id");

-- ical_tokens: tres feeds de suscripción por usuario, revocables.
CREATE TABLE IF NOT EXISTS "app"."ical_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app"."users"("id") ON DELETE cascade,
  "scope" "public"."ical_scope" NOT NULL,
  "token" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_accessed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ical_tokens_token_unique" UNIQUE("token")
);

CREATE INDEX IF NOT EXISTS "idx_ical_tokens_user_id" ON "app"."ical_tokens" ("user_id");
-- Un solo token activo (no revocado) por usuario y scope.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ical_tokens_user_scope_active"
  ON "app"."ical_tokens" ("user_id", "scope") WHERE "revoked_at" IS NULL;

-- agenda_notification_prefs: preferencias de recordatorios por secretario.
CREATE TABLE IF NOT EXISTS "app"."agenda_notification_prefs" (
  "user_id" uuid PRIMARY KEY REFERENCES "app"."users"("id") ON DELETE cascade,
  "prefs" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
