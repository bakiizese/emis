# Architecture

How EMIS fits together, in four pictures. The decisions behind them, and what was given up, are in the
[architecture decision records](adr/README.md).

## The running system

One institution, one server. Caddy is the only thing exposed to the internet.

```mermaid
flowchart LR
  visitor([Visitors and applicants]) --> caddy
  staff([Staff]) --> caddy

  subgraph server[One server, Docker Compose]
    caddy[Caddy<br/>HTTPS, routes /api]
    web[Website<br/>Next.js]
    portal[Portal<br/>Next.js]
    api[API<br/>NestJS + Fastify]
    worker[Worker<br/>outbox, jobs, reminders]
    pdf[Gotenberg<br/>HTML to PDF]
    pg[(PostgreSQL 18)]
    vk[(Valkey<br/>job queues)]
    backup[Backup<br/>nightly, encrypted]
    offsite[Offsite copier]
    caddy -->|"/ on the public address"| web
    caddy -->|"/ on the portal address"| portal
    caddy -->|"/api on both"| api
    web -->|"server-side reads"| api
    api --> pg
    api --> pdf
    worker --> pg
    worker --> vk
    backup --> pg
    backup -.->|"encrypted files"| offsite
  end

  worker -->|SMTP| mail([Email provider])
  offsite -->|"encrypted copies"| storage([Offsite storage])
  caddy -->|certificates| acme([Let's Encrypt])
```

Only Caddy and the worker can reach the internet (Caddy for certificates, the worker for email), and the offsite copier for
the backups; the API, the two sites, the database, the queue and the PDF service cannot. See [ADR 0011](adr/0011-deployment-and-recovery.md).

## The API's modules

The API is one deployable made of modules with enforced boundaries: a module may import another only through its public
`index.ts` (checked by `pnpm deps:check` in CI). Arrows mean "uses". Every module also uses **audit** (an append-only,
hash-chained log written in the same transaction as the change) and **settings** (institution profile, branches,
departments, module switches, numbering); those arrows are left out to keep the picture readable.

```mermaid
flowchart TD
  identity[identity<br/>accounts, sessions, MFA]
  access[access<br/>roles, permissions, invitations]
  catalog[catalog<br/>programs, courses, calendar,<br/>shifts, rooms]
  students[students<br/>records, guardians,<br/>duplicate detection]
  admissions[admissions<br/>applications]
  cohorts[cohorts<br/>classes, enrollment, results]
  billing[billing<br/>fees, invoices, payments,<br/>approvals]
  documents[documents<br/>receipts, ID cards,<br/>certificates, verification]
  posts[posts<br/>news]
  reports[reports<br/>revenue, outstanding]
  dashboard[dashboard<br/>portal home]
  imports[imports<br/>student CSV]
  public[public<br/>website endpoints]

  access --> identity
  admissions --> catalog & students
  cohorts --> catalog & students & admissions & access
  billing --> catalog & students & cohorts
  documents --> catalog & students & cohorts & billing
  dashboard --> access & cohorts & reports
  imports --> students
  public --> catalog & cohorts & admissions & posts
```

Inside each module the same four folders keep the layers apart: `domain/` (pure rules, no framework or database),
`application/` (services that run in transactions), `infrastructure/` (adapters such as the PDF renderer) and
`interface/` (HTTP controllers that validate with the shared Zod contracts and declare the access rule).

## What happens when someone pre-registers

Nothing in a web request sends an email or talks to another system. It writes to the database, and the worker delivers
afterwards. That is what makes a retry, a crash or a double-click safe.

```mermaid
sequenceDiagram
  actor V as Visitor
  participant W as Website (browser)
  participant A as API
  participant D as PostgreSQL
  participant K as Worker
  participant M as Mail server

  V->>W: fills in the form, presses Send
  W->>A: POST /api/v1/public/pre-registrations<br/>Idempotency-Key: (a UUID for this form)
  A->>D: begin
  A->>D: lock on the phone number, look for an open request
  A->>D: insert application, audit entry, and an email row in the outbox
  A->>D: store the response under the idempotency key
  A->>D: commit (all of it, or none of it)
  A-->>W: 201 with the reference number
  Note over W,A: A retry with the same key gets the stored answer, no second application
  K->>D: relay outbox rows to the queue (skip locked)
  K->>M: deliver the email
  M-->>V: "We received your request (APP-...)"
```

## Money

A payment touches four things that must always agree, so they change together under one row lock.

```mermaid
flowchart LR
  pay[Record a payment] --> lock[Lock the invoice row]
  lock --> alloc[Pay the oldest instalment first,<br/>refuse an overpayment]
  alloc --> settle[Recompute the invoice<br/>from its instalments]
  settle --> rcpt[Issue the next gapless<br/>receipt number]
  rcpt --> audit[Write the audit entry]
  audit --> commit((commit))
```

Recorded money is never edited: the database role the API uses cannot delete or truncate it, and triggers refuse changes to
an amount, number or line item. A mistake is corrected by voiding (which needs a second person) and the void keeps the
receipt number it used. See [ADR 0007](adr/0007-money-and-immutable-records.md).
