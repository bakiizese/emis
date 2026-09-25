CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"subject_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approval_requests_type_check" CHECK ("approval_requests"."type" in ('discount', 'payment_void')),
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "approval_requests_separation_check" CHECK ("approval_requests"."decided_by" is null or "approval_requests"."decided_by" <> "approval_requests"."requested_by"),
	CONSTRAINT "approval_requests_decided_check" CHECK (("approval_requests"."status" = 'pending') = ("approval_requests"."decided_by" is null))
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_kind_check" CHECK ("discounts"."kind" in ('percent', 'fixed')),
	CONSTRAINT "discounts_amount_check" CHECK ("discounts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"course_id" uuid NOT NULL,
	"category_code" text,
	"effective_from" date NOT NULL,
	"currency" text NOT NULL,
	"components" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fee_structures_course_category_from_key" UNIQUE NULLS NOT DISTINCT("course_id","category_code","effective_from"),
	CONSTRAINT "fee_structures_total_check" CHECK ("fee_structures"."total" > 0)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "installments_invoice_sequence_key" UNIQUE("invoice_id","sequence"),
	CONSTRAINT "installments_amount_check" CHECK ("installments"."amount" >= 0),
	CONSTRAINT "installments_paid_check" CHECK ("installments"."paid_amount" >= 0 and "installments"."paid_amount" <= "installments"."amount")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"number" text NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"cohort_id" uuid,
	"branch_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"paid_total" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('issued', 'partially_paid', 'paid', 'void')),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."subtotal" > 0 and "invoices"."discount_total" >= 0 and "invoices"."discount_total" <= "invoices"."subtotal"),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."total" = "invoices"."subtotal" - "invoices"."discount_total"),
	CONSTRAINT "invoices_paid_check" CHECK ("invoices"."paid_total" >= 0 and "invoices"."paid_total" <= "invoices"."total")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_installment_id_pk" PRIMARY KEY("payment_id","installment_id"),
	CONSTRAINT "payment_allocations_amount_check" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"installments" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('posted', 'void')),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('cash', 'bank_transfer', 'cheque'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "receipts_status_check" CHECK ("receipts"."status" in ('issued', 'void'))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_accounts_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_requests_subject_idx" ON "approval_requests" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_key" ON "approval_requests" USING btree ("type","subject_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "discounts_invoice_id_idx" ON "discounts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_structures_course_id_idx" ON "fee_structures" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "installments_due_date_idx" ON "installments" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_enrollment_id_key" ON "invoices" USING btree ("enrollment_id") WHERE "invoices"."enrollment_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_student_id_idx" ON "invoices" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_name_key" ON "payment_plans" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_one_default_key" ON "payment_plans" USING btree ("is_default") WHERE "payment_plans"."is_default";--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_student_id_idx" ON "payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_number_key" ON "receipts" USING btree ("number");--> statement-breakpoint
-- Money records are never deleted, and the app role can't even try. Allocations and discounts are
-- written once and never updated either.
REVOKE DELETE, TRUNCATE ON "fee_structures", "payment_plans", "invoices", "installments", "payments",
	"payment_allocations", "receipts", "discounts", "approval_requests" FROM emis_writer;--> statement-breakpoint
REVOKE UPDATE ON "payment_allocations", "discounts" FROM emis_writer;--> statement-breakpoint
-- Columns that define a recorded fact can't be changed, whoever runs the UPDATE. Only status and
-- running totals (paid, discount, void state) may move, and the services change those together.
CREATE FUNCTION emis_forbid_column_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	col text;
BEGIN
	FOREACH col IN ARRAY TG_ARGV LOOP
		IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
			RAISE EXCEPTION 'Column % of % cannot be changed once recorded', col, TG_TABLE_NAME
				USING ERRCODE = 'restrict_violation';
		END IF;
	END LOOP;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoices_immutable BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('number', 'student_id', 'enrollment_id', 'cohort_id', 'branch_id', 'currency', 'lines', 'subtotal');--> statement-breakpoint
CREATE TRIGGER installments_immutable BEFORE UPDATE ON "installments" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('invoice_id', 'sequence', 'due_date');--> statement-breakpoint
CREATE TRIGGER payments_immutable BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('invoice_id', 'student_id', 'branch_id', 'provider_key', 'method', 'reference', 'amount', 'currency', 'received_by', 'received_at');--> statement-breakpoint
CREATE TRIGGER receipts_immutable BEFORE UPDATE ON "receipts" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('payment_id', 'number', 'branch_id', 'issued_at');--> statement-breakpoint
CREATE TRIGGER fee_structures_immutable BEFORE UPDATE ON "fee_structures" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('course_id', 'category_code', 'effective_from', 'currency', 'components', 'total');--> statement-breakpoint
CREATE TRIGGER approval_requests_immutable BEFORE UPDATE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION
	emis_forbid_column_changes('type', 'subject_id', 'payload', 'summary', 'reason', 'requested_by');--> statement-breakpoint
-- A decided approval is final.
CREATE FUNCTION emis_approval_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.status <> 'pending' THEN
		RAISE EXCEPTION 'A decided approval cannot be changed' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER approval_requests_final BEFORE UPDATE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION
	emis_approval_is_final();
