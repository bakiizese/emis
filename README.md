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
