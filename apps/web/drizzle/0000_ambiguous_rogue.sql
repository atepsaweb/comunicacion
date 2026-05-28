CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TYPE "public"."absence_source" AS ENUM('whatsapp', 'panel', 'admin');--> statement-breakpoint
CREATE TYPE "public"."absence_type" AS ENUM('scheduled_leave', 'weekly_pause');--> statement-breakpoint
CREATE TYPE "public"."ai_purpose" AS ENUM('extract', 'followup_question', 'consolidate', 'draft_social', 'draft_newsletter', 'classify_intent', 'other');--> statement-breakpoint
CREATE TYPE "public"."ai_triggered_by" AS ENUM('workflow', 'user_action', 'manual_test');--> statement-breakpoint
CREATE TYPE "public"."consolidation_status" AS ENUM('draft', 'approved', 'sent');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('pending', 'open', 'closed', 'processed', 'published');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_intent" AS ENUM('report', 'report_followup_reply', 'absence_request', 'weekly_pause', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'audio', 'other');--> statement-breakpoint
CREATE TYPE "public"."outbound_purpose" AS ENUM('weekly_trigger', 'reminder', 'followup_question', 'consolidation_delivery', 'otp', 'admin_message', 'other');--> statement-breakpoint
CREATE TYPE "public"."publication_kind" AS ENUM('internal_summary', 'social_instagram', 'social_facebook', 'social_x', 'newsletter', 'web_article');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'in_review', 'approved', 'published', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."publication_version_source" AS ENUM('ai_generated', 'human_edited');--> statement-breakpoint
CREATE TYPE "public"."report_item_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'awaiting_followup', 'complete', 'paused', 'on_leave', 'no_report');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('secretary', 'executive', 'press_admin');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone_e164" text NOT NULL,
	"role" "user_role" DEFAULT 'secretary' NOT NULL,
	"position" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."weekly_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"trigger_at" timestamp with time zone NOT NULL,
	"reminder_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"status" "cycle_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."absences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "absence_type" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"source" "absence_source" NOT NULL,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."inbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from_phone_e164" text NOT NULL,
	"user_id" uuid,
	"cycle_id" uuid,
	"kind" "message_kind" NOT NULL,
	"text_content" text,
	"audio_path" text,
	"audio_duration_sec" integer,
	"raw_payload" jsonb NOT NULL,
	"intent" "message_intent",
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"discard_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"to_phone_e164" text NOT NULL,
	"user_id" uuid,
	"cycle_id" uuid,
	"purpose" "outbound_purpose" NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"sent_at" timestamp with time zone NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'sent' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."transcriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"text" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"model" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcriptions_inbound_message_id_unique" UNIQUE("inbound_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."report_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description_md" text NOT NULL,
	"mentions" jsonb,
	"priority" "report_item_priority",
	"is_public_safe" boolean DEFAULT true NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"completeness_score" numeric(4, 3),
	"summary_md" text,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"followup_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."ai_invocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "ai_purpose" NOT NULL,
	"model" text NOT NULL,
	"prompt_id" uuid,
	"input_messages" jsonb NOT NULL,
	"output_text" text,
	"output_parsed" jsonb,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"triggered_by" "ai_triggered_by" NOT NULL,
	"related_report_id" uuid,
	"related_cycle_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."prompts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"model_hint" text NOT NULL,
	"system_prompt" text NOT NULL,
	"user_template" text NOT NULL,
	"output_schema" jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."consolidations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cycle_id" uuid NOT NULL,
	"internal_summary_md" text NOT NULL,
	"themes" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"status" "consolidation_status" DEFAULT 'draft' NOT NULL,
	CONSTRAINT "consolidations_cycle_id_unique" UNIQUE("cycle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."publication_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"publication_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body_md" text NOT NULL,
	"attachments" jsonb,
	"meta" jsonb,
	"source" "publication_version_source" NOT NULL,
	"created_by" uuid,
	"ai_invocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cycle_id" uuid NOT NULL,
	"consolidation_id" uuid NOT NULL,
	"kind" "publication_kind" NOT NULL,
	"current_version_id" uuid,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."absences" ADD CONSTRAINT "absences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."absences" ADD CONSTRAINT "absences_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."inbound_messages" ADD CONSTRAINT "inbound_messages_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."outbound_messages" ADD CONSTRAINT "outbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."outbound_messages" ADD CONSTRAINT "outbound_messages_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."transcriptions" ADD CONSTRAINT "transcriptions_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "app"."inbound_messages"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."report_items" ADD CONSTRAINT "report_items_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "app"."reports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."reports" ADD CONSTRAINT "reports_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."ai_invocations" ADD CONSTRAINT "ai_invocations_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "app"."prompts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."ai_invocations" ADD CONSTRAINT "ai_invocations_related_report_id_reports_id_fk" FOREIGN KEY ("related_report_id") REFERENCES "app"."reports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."ai_invocations" ADD CONSTRAINT "ai_invocations_related_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("related_cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."prompts" ADD CONSTRAINT "prompts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."consolidations" ADD CONSTRAINT "consolidations_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."consolidations" ADD CONSTRAINT "consolidations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."publication_versions" ADD CONSTRAINT "publication_versions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "app"."publications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."publication_versions" ADD CONSTRAINT "publication_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."publication_versions" ADD CONSTRAINT "publication_versions_ai_invocation_id_ai_invocations_id_fk" FOREIGN KEY ("ai_invocation_id") REFERENCES "app"."ai_invocations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."publications" ADD CONSTRAINT "publications_cycle_id_weekly_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app"."weekly_cycles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."publications" ADD CONSTRAINT "publications_consolidation_id_consolidations_id_fk" FOREIGN KEY ("consolidation_id") REFERENCES "app"."consolidations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
