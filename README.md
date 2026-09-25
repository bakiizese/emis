# EMIS

A configurable, self-hosted **Education Management Information System** for training institutions:
public website, student information system, finance and an admin dashboard on one backend.

Each institution runs its own install and configures it for what it teaches: a single English
program, or several departments (Language, Computer, Music, Tutoring…) with their own programs,
shifts, rooms and fees.

> Status: early development. First deployment: Lingua Computer and Language Institute.

## Architecture

| Part                 | Tech                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api`           | NestJS 12 on Fastify, modular monolith, REST under `/api/v1`; `src/worker.ts` runs background jobs |
| `apps/portal`        | Next.js 16 staff portal (admin dashboard, SIS, finance)                                            |
| `apps/web`           | Next.js 16 public website                                                                          |
| `packages/contracts` | Zod schemas shared by backend and frontends                                                        |
| `packages/ui`        | Design system (Tailwind CSS v4, shadcn/ui style)                                                   |
| Data                 | PostgreSQL 18, Valkey (cache and queues), S3 object storage, Gotenberg (PDF)                       |

## Getting started

Requirements: Node 24 (`nvm use`), Docker, corepack.

```bash
corepack enable          # provides the pinned pnpm version
pnpm install
cp .env.example .env     # then set the passwords
pnpm infra:up            # Postgres, Valkey, S3, Gotenberg, Mailpit
pnpm db:bootstrap        # once: creates the database roles (safe to re-run)
pnpm db:migrate          # applies migrations
pnpm --filter @emis/api account:create-admin   # first admin, or grant Admin to an existing account
pnpm dev                 # api :4000 + worker · web :3000 · portal :3001
```

Set `ENCRYPTION_KEY` in `.env` first (`openssl rand -base64 32`). Then sign in at
http://localhost:3001/login, where the admin is walked through authenticator-app setup and then the
first-run setup wizard (institution details, branches, departments).

- API health: `curl http://localhost:4000/api/v1/health` (readiness: `/api/v1/health/ready`)
- API reference: http://localhost:4000/api/docs
- Outgoing email in dev: http://localhost:8025

### Institution setup

Nothing about an institution is hard-coded. An admin configures it from the portal:

- **Setup wizard** on first sign-in: profile, branding, currency, time zone, fiscal year, branches, and
  departments from starting packs (Language, Computer, Tutoring) or their own
- **Branches and departments**, which roles can be limited to (a Secretary at one campus, a Coordinator
  for one department)
- **Module switches** (website, pre-registration, placement, certificates…). A switched-off module's
  routes answer 404 and its screens disappear
- **Dropdown lists, custom fields and terminology** (call a cohort a "Batch") without code changes
- **Numbering patterns** like `RCP-{BRANCH}-{FY}-{SEQ:6}`, issued from gapless counters: concurrent
  issuers queue on a row lock, and a rolled-back transaction gives its number back
- Settings changes need `If-Match` with the version you read, so two admins can't silently overwrite
  each other (412 on conflict), and every change lands in the audit log

### Academic catalog

- **Programs and courses** under each department (e.g. English → A1, A2, B1…), with prerequisites
  and completion rules (minimum attendance %, pass mark, whether it earns a certificate). Prerequisites
  stay inside one program and can't form a loop, even when two people edit at the same moment
- **Academic calendar:** academic years (the database refuses overlapping ranges), intake windows with
  registration open/close times, and holidays that apply to every branch or just one
- **Shifts** (days of the week + time window) and **rooms** with seats and features per branch
- A Coordinator limited to one department can edit only that department's programs and courses;
  everything else here is Admin-only. Every staff role can read the catalog

### Students and admissions

- **Student records** with Ethiopian-style names (first, father's, grandfather's), a normalized phone
  ("0911 22 33 44" and "+251 911-223344" are the same number), guardians (one main contact, one payer),
  the institution's own categories and custom fields, and numbers from the configurable pattern
- **Search** by name words in any order, student number or part of a phone, on a trigram index; lists page with keyset cursors
- **Duplicate detection** before registering: same phone, same email or a near-identical name (typos
  included), across every branch. It stops the registration until someone confirms it's a different person
- **Admissions pipeline:** submitted → contacted → placement scheduled → placed → offered → confirmed → enrolled,
  with rejected / withdrawn / expired exits, as a small state machine. A placement result recommends a
  starting level and is limited by department; registering an offered applicant as a student is one locked
  step, so a double click makes one student, not two
- A Secretary is limited to their branch's students and applicants. Audit entries say what changed and
  by whom, never the person's details

### Cohorts and enrollment

- **Cohorts** are scheduled classes: a course in a shift and room, with an instructor and a date range.
  Sessions are generated from the shift's days, skipping holidays, at the institution's clock time
- **No double-booking, enforced by Postgres:** an EXCLUDE constraint refuses two sessions that overlap
  in the same room or with the same instructor (back-to-back is fine). The API turns it into a clear
  409, and a cohort that clashes leaves nothing behind
- **Seats:** a cohort takes the smaller of its own limit and its room's seats. Enrolling locks the cohort
  row, so 50 simultaneous requests for the last seat give it to exactly one and waitlist the other 49
  (a test removes the lock to prove it would otherwise fail)
- **Waitlist:** numbered, first come first served. When someone withdraws, the longest-waiting student
  takes the seat in the same transaction, so a seat is never left empty while people wait
- **Prerequisites** must be completed first; **results** are decided by the course's completion rules
  (minimum score, minimum attendance), and a rule that needs a number that wasn't given is refused rather
  than failed. Recording a result is limited to the course's department
- Enrolling a student who came from an application finishes that application

### Authentication

- Server-side sessions in an HttpOnly `__Host-` cookie (only a SHA-256 of the token is stored), with idle and absolute timeouts
- Argon2id passwords, checked against common and personal-info patterns (zxcvbn)
- TOTP two-factor with replay protection and single-use recovery codes; secrets encrypted with AES-256-GCM
- Generic errors and constant-time checks (no account enumeration), progressive lockout, per-IP rate limits
- CSRF protection via Origin / Fetch-Metadata checks on every state-changing request
- Append-only security event log (the app's database role can't update or delete it)

### Access control

- Four built-in roles (Admin, Coordinator, Secretary, Instructor) defined in `packages/permissions`,
  synced into the database on every migrate. Roles can be granted institution-wide or per branch/department
- Every API route declares `@Public()`, `@SelfService()` or `@RequirePermission(...)`. Anything else is
  denied, and a test fails CI if a route forgets
- A permission matrix test checks every role against every protected endpoint
- Staff join by invitation (single-use link, 72 h). The last active admin can't be removed or disabled
- Hash-chained, append-only audit log of staff and role changes, with an integrity check in the portal

### Reliability

- **Idempotency keys:** side-effecting endpoints accept an `Idempotency-Key`. A retry (double-click, flaky
  network) replays the first response instead of repeating the work, even under concurrent duplicates
- **Transactional outbox:** events (like emails) are written in the same transaction as the change and
  delivered by the worker through BullMQ on Valkey. Rolled-back changes send nothing; crashes lose nothing.
  Payloads carrying links or tokens are encrypted at rest and in the queue
- **Exactly-once handlers:** an inbox table makes redelivered events run once per handler
- **Housekeeping jobs** (expired keys, delivered events, dead sessions) run on fixed schedules

### Database roles

The API never connects as a superuser. `pnpm db:bootstrap` creates three roles from the URLs in `.env`:

| Role            | Used by     | Can                                        |
| --------------- | ----------- | ------------------------------------------ |
| `emis_migrator` | migrations  | own the schema, run DDL                    |
| `emis_app`      | API, worker | read and write rows; no DDL, no `TRUNCATE` |
| `emis_readonly` | reporting   | `SELECT` only, read-only transactions      |

## Quality checks

```bash
pnpm check              # lint + typecheck + unit tests
pnpm test:integration   # against a real Postgres in Docker (Testcontainers)
pnpm deps:check   # architectural boundaries
pnpm format       # Prettier
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are checked by a
git hook.
