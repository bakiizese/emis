CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "branches_code_check" CHECK ("branches"."code" ~ '^[A-Z0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custom_field_definitions_entity_type_check" CHECK ("custom_field_definitions"."entity_type" in ('student', 'application', 'staff', 'cohort')),
	CONSTRAINT "custom_field_definitions_field_type_check" CHECK ("custom_field_definitions"."field_type" in ('text', 'long_text', 'number', 'date', 'select', 'checkbox'))
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "departments_code_check" CHECK ("departments"."code" ~ '^[A-Z0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "descriptors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"namespace" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institution" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"tagline" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" text,
	"city" text,
	"country" text DEFAULT 'ET' NOT NULL,
	"primary_color" text DEFAULT '#1d4ed8' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"timezone" text DEFAULT 'Africa/Addis_Ababa' NOT NULL,
	"calendar_display" text DEFAULT 'gregorian' NOT NULL,
	"fiscal_year_start" text DEFAULT '07-08' NOT NULL,
	"setup_completed_at" timestamp with time zone,
	CONSTRAINT "institution_singleton_check" CHECK ("institution"."singleton"),
	CONSTRAINT "institution_locale_check" CHECK ("institution"."locale" in ('en', 'am')),
	CONSTRAINT "institution_calendar_display_check" CHECK ("institution"."calendar_display" in ('gregorian', 'ethiopian', 'both'))
);
--> statement-breakpoint
CREATE TABLE "module_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "number_counters" (
	"series_key" text NOT NULL,
	"scope" text NOT NULL,
	"last_value" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_counters_series_key_scope_pk" PRIMARY KEY("series_key","scope"),
	CONSTRAINT "number_counters_last_value_check" CHECK ("number_counters"."last_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"key" text PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "terminology_overrides" (
	"key" text PRIMARY KEY NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_key" ON "branches" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_entity_key_key" ON "custom_field_definitions" USING btree ("entity_type","key");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_key" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "descriptors_namespace_code_key" ON "descriptors" USING btree ("namespace","code");--> statement-breakpoint
CREATE UNIQUE INDEX "institution_singleton_key" ON "institution" USING btree ("singleton");--> statement-breakpoint
-- Single-tenant: the one institution row exists from the start; the setup wizard fills it in.
INSERT INTO "institution" ("name", "short_name") VALUES ('New institution', 'EMIS');
--> statement-breakpoint
-- The app may update but never remove the institution row or reset a document counter.
REVOKE DELETE, TRUNCATE ON "institution" FROM emis_writer;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "number_counters" FROM emis_writer;
