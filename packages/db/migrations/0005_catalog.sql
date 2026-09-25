CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "academic_years_date_range_check" CHECK ("academic_years"."start_date" < "academic_years"."end_date")
);
--> statement-breakpoint
CREATE TABLE "course_prerequisites" (
	"course_id" uuid NOT NULL,
	"prerequisite_course_id" uuid NOT NULL,
	CONSTRAINT "course_prerequisites_course_id_prerequisite_course_id_pk" PRIMARY KEY("course_id","prerequisite_course_id"),
	CONSTRAINT "course_prerequisites_not_self_check" CHECK ("course_prerequisites"."course_id" <> "course_prerequisites"."prerequisite_course_id")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"program_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_order" integer DEFAULT 0 NOT NULL,
	"duration_weeks" integer,
	"total_hours" integer,
	"min_attendance_percent" integer,
	"min_score" double precision,
	"certificate_eligible" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "courses_min_attendance_percent_check" CHECK ("courses"."min_attendance_percent" is null or "courses"."min_attendance_percent" between 0 and 100),
	CONSTRAINT "courses_min_score_check" CHECK ("courses"."min_score" is null or "courses"."min_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_recurring_annually" boolean DEFAULT false NOT NULL,
	"branch_id" uuid,
	CONSTRAINT "holidays_date_branch_key" UNIQUE NULLS NOT DISTINCT("date","branch_id")
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"program_id" uuid,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "intakes_registration_window_check" CHECK ("intakes"."registration_opens_at" is null or "intakes"."registration_closes_at" is null
        or "intakes"."registration_opens_at" < "intakes"."registration_closes_at")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"department_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "programs_type_check" CHECK ("programs"."type" in ('long_course', 'short_course', 'exam_prep'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"capacity" integer NOT NULL,
	"features" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rooms_type_check" CHECK ("rooms"."type" in ('classroom', 'lab', 'studio')),
	CONSTRAINT "rooms_capacity_check" CHECK ("rooms"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"start_time" time(0) NOT NULL,
	"end_time" time(0) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shifts_time_range_check" CHECK ("shifts"."start_time" < "shifts"."end_time")
);
--> statement-breakpoint
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_prerequisite_course_id_courses_id_fk" FOREIGN KEY ("prerequisite_course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_name_key" ON "academic_years" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_program_id_code_key" ON "courses" USING btree ("program_id","code");--> statement-breakpoint
CREATE INDEX "courses_program_id_idx" ON "courses" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "holidays_branch_id_idx" ON "holidays" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "intakes_program_id_idx" ON "intakes" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_code_key" ON "programs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "programs_department_id_idx" ON "programs" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_branch_id_code_key" ON "rooms" USING btree ("branch_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts" USING btree ("code");--> statement-breakpoint
-- Academic years may not overlap. drizzle-kit can't express an EXCLUDE constraint, so it's added here.
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_no_overlap"
	EXCLUDE USING gist (daterange("start_date", "end_date", '[)') WITH &&);
