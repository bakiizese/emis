# EMIS

A configurable, self-hosted **Education Management Information System** for training institutions:
public website, student information system, finance and an admin dashboard on one backend.

Each institution runs its own install and configures it for what it teaches: a single English
program, or several departments (Language, Computer, Music, Tutoring…) with their own programs,
shifts, rooms and fees.

> Status: early development. First deployment: Lingua Computer and Language Institute.

## Architecture

| Part                 | Tech                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `apps/api`           | NestJS 12 on Fastify, modular monolith, REST under `/api/v1`                 |
| `apps/worker`        | NestJS standalone app for background jobs                                    |
| `apps/portal`        | Next.js 16 staff portal (admin dashboard, SIS, finance)                      |
| `apps/web`           | Next.js 16 public website                                                    |
| `packages/contracts` | Zod schemas shared by backend and frontends                                  |
| `packages/ui`        | Design system (Tailwind CSS v4, shadcn/ui style)                             |
| Data                 | PostgreSQL 18, Valkey (cache and queues), S3 object storage, Gotenberg (PDF) |

## Getting started

Requirements: Node 24 (`nvm use`), Docker, corepack.

```bash
corepack enable          # provides the pinned pnpm version
pnpm install
cp .env.example .env     # then set the passwords
pnpm infra:up            # Postgres, Valkey, S3, Gotenberg, Mailpit
pnpm db:bootstrap        # once: creates the database roles (safe to re-run)
pnpm db:migrate          # applies migrations
pnpm --filter @emis/api account:create-admin   # first admin (two-factor sign-in enforced)
pnpm dev                 # api :4000 · web :3000 · portal :3001
```

Set `ENCRYPTION_KEY` in `.env` first (`openssl rand -base64 32`). Then sign in at
http://localhost:3001/login, where the admin is walked through authenticator-app setup.

- API health: `curl http://localhost:4000/api/v1/health` (readiness: `/api/v1/health/ready`)
- API reference: http://localhost:4000/api/docs
- Outgoing email in dev: http://localhost:8025

### Authentication

- Server-side sessions in an HttpOnly `__Host-` cookie (only a SHA-256 of the token is stored), with idle and absolute timeouts
- Argon2id passwords, checked against common and personal-info patterns (zxcvbn)
- TOTP two-factor with replay protection and single-use recovery codes; secrets encrypted with AES-256-GCM
- Generic errors and constant-time checks (no account enumeration), progressive lockout, per-IP rate limits
- CSRF protection via Origin / Fetch-Metadata checks on every state-changing request
- Append-only security event log (the app's database role can't update or delete it)

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
