# Architecture decision records

Each record explains one decision that shapes the system: what problem it answers, what was chosen, what it costs, and what
else was considered. They are short on purpose. When a decision changes, write a new record that supersedes the old one
rather than editing history.

| #                                                | Decision                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [0001](0001-single-tenant-modular-monolith.md)   | One install per institution, one modular monolith, configuration over code  |
| [0002](0002-postgres-and-database-invariants.md) | PostgreSQL, and the database enforces the rules that must never break       |
| [0003](0003-contract-first-with-zod.md)          | Contract first: one Zod schema for the API and both frontends               |
| [0004](0004-authentication.md)                   | Server-side sessions, Argon2id and mandatory two-factor for administrators  |
| [0005](0005-authorization.md)                    | Permissions in code, roles as data, deny by default, a second pair of eyes  |
| [0006](0006-reliable-side-effects.md)            | Outbox, idempotency keys and optimistic locking                             |
| [0007](0007-money-and-immutable-records.md)      | Money as whole santim, immutable records, gapless numbers                   |
| [0008](0008-payment-providers.md)                | Payments go through a provider interface; only manual payments exist today  |
| [0009](0009-documents-and-verification.md)       | PDFs from HTML in a sandboxed service, and QR codes anyone can verify       |
| [0010](0010-browser-and-network-hardening.md)    | A nonce-based content security policy and an inventory of anonymous routes  |
| [0011](0011-deployment-and-recovery.md)          | One server behind Caddy, isolated networks, encrypted and rehearsed backups |

## Writing a new one

Copy the shape of any record here: **Context** (the forces at play), **Decision**, **Consequences** (good and bad), and
**Alternatives considered**. Number it next, add it to the table, and link it from the code or docs it governs.
