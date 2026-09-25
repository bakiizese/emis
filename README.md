# EMIS

A configurable, self-hosted **Education Management Information System** for training institutions:
public website, student information system, finance and an admin dashboard on one backend.

Each institution runs its own install and configures it for what it teaches: a single English
program, or several departments (Language, Computer, Music, Tutoring…) with their own programs,
shifts, rooms and fees.

> Status: early development (`chore/p1-bootstrap`). First deployment: Lingua Computer and Language Institute.

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
pnpm dev                 # api :4000 · web :3000 · portal :3001
```

Check the API: `curl http://localhost:4000/api/v1/health`

## Quality checks

```bash
pnpm check        # lint + typecheck + tests (same as CI)
pnpm deps:check   # architectural boundaries
pnpm format       # Prettier
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are checked by a
git hook.
