CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"given_name" text NOT NULL,
	"father_name" text NOT NULL,
	"grandfather_name" text,
	"gender" text NOT NULL,
	"date_of_birth" date,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"city" text,
	"branch_id" uuid NOT NULL,
	"source" text,
	"desired_course_id" uuid,
	"preferred_shift_id" uuid,
	"preferred_intake_id" uuid,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placement_score" double precision,
	"placement_course_id" uuid,
	"placement_notes" text,
	"placed_at" timestamp with time zone,
	"student_id" uuid,
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" in ('submitted', 'contacted', 'placement_scheduled', 'placed', 'offered', 'confirmed', 'enrolled', 'rejected', 'withdrawn', 'expired')),
	CONSTRAINT "applications_gender_check" CHECK ("applications"."gender" in ('female', 'male')),
	CONSTRAINT "applications_placement_score_check" CHECK ("applications"."placement_score" is null or "applications"."placement_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_payer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"student_number" text NOT NULL,
	"given_name" text NOT NULL,
	"father_name" text NOT NULL,
	"grandfather_name" text,
	"search_name" text GENERATED ALWAYS AS (lower(given_name || ' ' || father_name || ' ' || coalesce(grandfather_name, ''))) STORED NOT NULL,
	"gender" text NOT NULL,
	"date_of_birth" date,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"city" text,
	"status" text DEFAULT 'active' NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_code" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "students_gender_check" CHECK ("students"."gender" in ('female', 'male')),
	CONSTRAINT "students_status_check" CHECK ("students"."status" in ('active', 'on_hold', 'graduated', 'withdrawn', 'alumni'))
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_desired_course_id_courses_id_fk" FOREIGN KEY ("desired_course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_preferred_shift_id_shifts_id_fk" FOREIGN KEY ("preferred_shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_preferred_intake_id_intakes_id_fk" FOREIGN KEY ("preferred_intake_id") REFERENCES "public"."intakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_placement_course_id_courses_id_fk" FOREIGN KEY ("placement_course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_reference_key" ON "applications" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_branch_id_idx" ON "applications" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "applications_phone_idx" ON "applications" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "applications_student_id_idx" ON "applications" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_guardians_student_id_idx" ON "student_guardians" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_one_primary_key" ON "student_guardians" USING btree ("student_id") WHERE "student_guardians"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_one_payer_key" ON "student_guardians" USING btree ("student_id") WHERE "student_guardians"."is_payer";--> statement-breakpoint
CREATE UNIQUE INDEX "students_student_number_key" ON "students" USING btree ("student_number");--> statement-breakpoint
CREATE INDEX "students_search_name_trgm_idx" ON "students" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_phone_idx" ON "students" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "students_email_idx" ON "students" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "students_branch_id_idx" ON "students" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "students_created_at_idx" ON "students" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);