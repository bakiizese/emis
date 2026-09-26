CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"serial" text NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"student_name" text NOT NULL,
	"course_name" text NOT NULL,
	"completed_on" date NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "certificates_status_check" CHECK ("certificates"."status" in ('issued', 'revoked')),
	CONSTRAINT "certificates_revoked_check" CHECK (("certificates"."status" = 'revoked') = ("certificates"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"installment_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_outcome_check" CHECK ("reminder_log"."outcome" in ('queued', 'no_contact'))
);
--> statement-breakpoint
CREATE TABLE "student_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"student_id" uuid NOT NULL,
	"token" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "student_cards_status_check" CHECK ("student_cards"."status" in ('active', 'revoked')),
	CONSTRAINT "student_cards_dates_check" CHECK ("student_cards"."valid_until" >= "student_cards"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "institution" ADD COLUMN "certificate_requires_paid_in_full" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_serial_key" ON "certificates" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_token_key" ON "certificates" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_one_issued_per_enrollment_key" ON "certificates" USING btree ("enrollment_id") WHERE "certificates"."status" = 'issued';--> statement-breakpoint
CREATE INDEX "certificates_student_id_idx" ON "certificates" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_log_installment_stage_key" ON "reminder_log" USING btree ("installment_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "student_cards_token_key" ON "student_cards" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "student_cards_one_active_per_student_key" ON "student_cards" USING btree ("student_id") WHERE "student_cards"."status" = 'active';--> statement-breakpoint
-- A certificate or card is never deleted, and what it says never changes: only its status moves.
REVOKE DELETE, TRUNCATE ON "certificates", "student_cards", "reminder_log" FROM emis_writer;--> statement-breakpoint
REVOKE UPDATE ON "reminder_log" FROM emis_writer;--> statement-breakpoint
CREATE TRIGGER certificates_immutable BEFORE UPDATE ON "certificates" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('serial', 'enrollment_id', 'student_id', 'course_id', 'student_name', 'course_name', 'completed_on', 'token', 'issued_at');--> statement-breakpoint
CREATE TRIGGER student_cards_immutable BEFORE UPDATE ON "student_cards" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('student_id', 'token', 'valid_from', 'valid_until', 'issued_at');
