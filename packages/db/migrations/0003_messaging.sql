CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"principal" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" smallint NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	"actor_user_id" uuid,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_principal_key_key" ON "idempotency_keys" USING btree ("principal","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at","id") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "processed_events" USING btree ("processed_at");--> statement-breakpoint
-- Wake the outbox relay the moment an event is committed (it also polls as a fallback).
CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_events', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_notify AFTER INSERT ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION outbox_notify();
