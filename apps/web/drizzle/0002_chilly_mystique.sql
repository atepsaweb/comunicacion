CREATE TABLE IF NOT EXISTS "app"."document_extractions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"text" text NOT NULL,
	"extraction_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extractions_inbound_message_id_unique" UNIQUE("inbound_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."access_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."affiliates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"aeropuerto" text,
	"organismo" text,
	"rama" text,
	"tipo" text,
	"vigencia" date,
	"dependency" text,
	"position" text,
	"dni" text,
	"legajo" text,
	"email" text,
	"phone_e164" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."inbound_messages" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "app"."inbound_messages" ADD COLUMN "document_path" text;--> statement-breakpoint
ALTER TABLE "app"."inbound_messages" ADD COLUMN "quoted_wamid" text;--> statement-breakpoint
ALTER TABLE "app"."inbound_messages" ADD COLUMN "quoted_body" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."document_extractions" ADD CONSTRAINT "document_extractions_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "app"."inbound_messages"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."access_tokens" ADD CONSTRAINT "access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."access_tokens" ADD CONSTRAINT "access_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."affiliates" ADD CONSTRAINT "affiliates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
