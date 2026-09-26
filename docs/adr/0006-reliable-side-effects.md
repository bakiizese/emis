# 0006. Outbox, idempotency keys and optimistic locking

Status: accepted

## Context

Networks are unreliable and people double-click. A payment request that times out gets sent again; an email must not go out
for a change that was rolled back; two staff can edit the same record; a server can crash between two steps. In a system
that moves money and enrolls students against limited seats, "usually works" is not enough.

## Decision

- **Transactional outbox.** A request never sends email or calls another system. It writes an outbox row in the same
  database transaction as the change. A separate worker reads the outbox (`FOR UPDATE SKIP LOCKED`), puts events on a BullMQ
  queue in Valkey, and handlers deliver. A rolled-back change sends nothing, a crash loses nothing, and payloads that hold
  links or tokens are encrypted at rest and in the queue. An inbox table makes a redelivered event run once per handler.
- **Idempotency keys.** Side-effecting POSTs (payments, enrollments, invoices, imports, pre-registration) require an
  `Idempotency-Key` header. The first request runs under an advisory lock on the key and stores its response in the same
  transaction as its writes, so the stored answer exists exactly when the work committed. A retry gets the stored answer;
  reusing a key for a different request is refused (422). Anonymous callers must use a UUID, so keys cannot be guessed.
- **Optimistic locking.** Every editable record carries a `version`. Updates send it in `If-Match` and the API refuses a
  stale one (412) or a missing one (428), so two people cannot silently overwrite each other.
- **Natural idempotency as well.** Unique indexes and row locks (ADR 0002) make the same operation from two different keys
  still produce one result, where it matters: ten simultaneous pre-registrations from one person create one application.
- **Scheduled work** (fee reminders, cleanup) goes through the same worker and must be safe to run twice, using a unique key
  per unit of work.

## Consequences

- Good: retries, crashes, double-clicks and concurrent workers cannot duplicate a payment, an enrollment or an email.
- Good: the queue can be lost (it is only a delivery mechanism) without losing the record of what must be sent.
- Bad: emails and other effects arrive a moment after the request, not during it, and the worker is one more process to run
  and watch. It is part of the standard deployment.
- Bad: every new side-effecting endpoint has to remember to opt in. A test per endpoint and the contributor notes cover it.

## Alternatives considered

- **Send directly from the request.** Loses messages on crashes and sends messages for rolled-back changes.
- **A message broker as the source of truth.** Adds a second system that must agree with the database; the outbox keeps the
  database authoritative.
- **Pessimistic locks held across a user's editing session.** Locks that outlive a request cause more trouble than conflicts.
