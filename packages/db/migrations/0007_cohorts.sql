CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"instructor_id" uuid,
	"session_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_time_range_check" CHECK ("class_sessions"."ends_at" > "class_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"course_id" uuid NOT NULL,
	"intake_id" uuid,
	"shift_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"instructor_id" uuid,
	"branch_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"max_size" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	CONSTRAINT "cohorts_date_range_check" CHECK ("cohorts"."end_date" >= "cohorts"."start_date"),
	CONSTRAINT "cohorts_max_size_check" CHECK ("cohorts"."max_size" > 0),
	CONSTRAINT "cohorts_status_check" CHECK ("cohorts"."status" in ('planned', 'open', 'running', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"student_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"waitlisted_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_reason" text,
	"score" double precision,
	"attendance_percent" double precision,
	"completed_at" timestamp with time zone,
	CONSTRAINT "enrollments_status_check" CHECK ("enrollments"."status" in ('waitlisted', 'active', 'completed', 'failed', 'withdrawn')),
	CONSTRAINT "enrollments_score_check" CHECK ("enrollments"."score" is null or "enrollments"."score" between 0 and 100),
	CONSTRAINT "enrollments_attendance_check" CHECK ("enrollments"."attendance_percent" is null or "enrollments"."attendance_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_instructor_id_user_accounts_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_instructor_id_user_accounts_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_sessions_cohort_id_idx" ON "class_sessions" USING btree ("cohort_id","session_date");--> statement-breakpoint
CREATE INDEX "class_sessions_room_id_idx" ON "class_sessions" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "cohorts_course_id_idx" ON "cohorts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "cohorts_room_id_idx" ON "cohorts" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "cohorts_instructor_id_idx" ON "cohorts" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "cohorts_branch_id_idx" ON "cohorts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "cohorts_start_date_idx" ON "cohorts" USING btree ("start_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_one_live_per_student_key" ON "enrollments" USING btree ("student_id","cohort_id") WHERE "enrollments"."status" in ('waitlisted', 'active');--> statement-breakpoint
CREATE INDEX "enrollments_cohort_status_idx" ON "enrollments" USING btree ("cohort_id","status");--> statement-breakpoint
CREATE INDEX "enrollments_student_id_idx" ON "enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "enrollments_created_at_idx" ON "enrollments" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- Nobody can be in two places at once: no two sessions may overlap in the same room or with the same
-- instructor. drizzle-kit can't express EXCLUDE constraints, so they're added here. A session
-- without an instructor never conflicts on that side (NULL is never equal to anything).
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_no_overlap"
	EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_instructor_no_overlap"
	EXCLUDE USING gist ("instructor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);
