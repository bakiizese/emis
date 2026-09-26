# 0011. One server behind Caddy, isolated networks, encrypted and rehearsed backups

Status: accepted

## Context

Each institution runs its own copy (ADR 0001), often on one small server or a machine in the office, with no operations team.
The deployment has to be something one person can install from a page of instructions, that is safe by default when it is
misconfigured, and whose recovery has been proved before it is needed. A backup that has never been restored is only a hope.

## Decision

- **A Docker Compose stack** runs everything: Caddy, the website, the portal, the API, the worker, PostgreSQL, Valkey,
  Gotenberg, and the backup services. Three images come from one Dockerfile (API and worker, website, portal), built on a
  Node-only base with the package managers removed, run as a non-root user, scanned in CI, and published on every merge and
  version tag with build provenance, an SBOM and a keyless signature.
- **Caddy in front** gets and renews HTTPS certificates and puts `/api` and each site on the same origin, which keeps the
  session cookie first-party and removes CORS (ADR 0004).
- **Isolated networks.** Only Caddy publishes ports. The database, queue, PDF service, API and both sites sit on internal
  networks with no route to the internet; only Caddy (certificates), the worker (email) and the offsite copier can reach out.
  A bug that tricks a service into fetching a URL has nowhere to go. A smoke test asserts this against a running stack.
- **Migrations run themselves.** A one-shot step creates the database roles if missing and applies pending migrations before
  the API starts. Migrations only move forward; the way back is a restore.
- **Backups.** Every night the database is dumped, restored into a scratch database to prove it works and compared with the
  live one, then encrypted with `age` to a **public key** and stored with a checksum. The server can make backups but never
  read them; the private key stays with the owner. A separate service with no database access copies the encrypted files
  offsite. The plain dump exists only in memory. The stack refuses to start without a backup key.
- **Recovery is rehearsed.** CI runs a disaster drill on every change: back up a running system, destroy the database, queue
  and local backups, rebuild on an empty stack from the offsite copy and the private key alone, and check the data and a
  sign-in came back. The documented recovery procedure is that script.

## Consequences

- Good: one page of steps to a working, HTTPS, isolated, backed-up system, and a recovery path known to work.
- Good: a compromised server or storage bucket does not expose backup contents, and a backup cannot silently be garbage.
- Bad: one server is one point of failure, so recovery means rebuilding rather than failing over. That is the right trade at
  this size, and the drill keeps the rebuild short.
- Bad: the private key is the owner's responsibility. Lose it and the backups cannot be opened; the guide says so at the step
  where the key is made.
- Not done: automatic deploy-to-server (updating is `pull` and `up -d`), point-in-time recovery (nightly means up to a day
  of changes can be lost), and re-verifying the audit log's hash chain after a restore.

## Alternatives considered

- **Kubernetes.** Powerful, and far more than one institution on one server should have to operate.
- **A managed platform.** Ties the product to a vendor and puts student data outside the institution's control.
- **Backups encrypted with a key on the server.** A server that can read its own backups gives an intruder the data twice.
- **Continuous archiving (point-in-time recovery).** A better recovery point, at real operational cost; a candidate once an
  institution needs it.
