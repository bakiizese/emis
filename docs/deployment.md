# Deploying EMIS

One institution, one server. Everything runs as containers behind Caddy, which gets and renews the
HTTPS certificates by itself.

## What you need

- A server with Docker (with the Compose plugin): 2 CPUs, 4 GB of memory and 40 GB of disk is plenty to start.
  A cloud VPS works; so does a machine in the institution's office if it has a fixed address, or a tunnel.
- Two names (for example `www.example.et` and `portal.example.et`) pointing at the server.
- Ports 80 and 443 (TCP, and 443 UDP for HTTP/3) open to the internet, plus 22 for you. **Nothing else.**
- An SMTP account for outgoing email (invitations, password resets, receipts, fee reminders).

## First install

1. Copy `infra/docker/compose.prod.yml`, `infra/docker/Caddyfile` and `infra/docker/.env.prod.example` to a
   folder on the server (for example `/opt/emis`). The example file becomes `.env`.
2. Fill in `.env`. Every setting is explained in the file. Make each secret with `openssl rand -hex 24`, and
   the encryption key with `openssl rand -base64 32`.
   **Keep a copy of `ENCRYPTION_KEY` somewhere safe, apart from the server.** Without it the two-factor secrets
   stored in the database cannot be read.
3. Start it:

   ```bash
   docker compose --env-file .env -f compose.prod.yml up -d
   ```

   The first start creates the database roles, applies the migrations and starts everything. Watch it with
   `docker compose --env-file .env -f compose.prod.yml ps`; when the API, website and portal say `healthy`, it is up.

4. Create the first administrator:

   ```bash
   docker compose --env-file .env -f compose.prod.yml exec \
     -e ADMIN_EMAIL=you@example.et -e ADMIN_NAME="Your Name" -e ADMIN_PASSWORD='a long passphrase' \
     api node dist/cli/create-admin.js
   ```

5. Open the portal address, sign in, set up two-factor authentication (required for administrators), and the
   setup wizard takes it from there.

## What is exposed, and what is not

Only Caddy publishes ports. Behind it:

| Container            | Can reach the internet? | Notes                                                       |
| -------------------- | ----------------------- | ----------------------------------------------------------- |
| Caddy                | yes                     | Needs it to obtain HTTPS certificates                       |
| Worker               | yes                     | Needs it to deliver email                                   |
| API, website, portal | no                      | A bug that tricks one into fetching a URL has nowhere to go |
| Database, queue      | no                      | Not reachable from outside the stack at all                 |
| PDF service          | no                      | Renders receipts and certificates from pages the API builds |

`infra/docker/smoke.sh` checks all of this against a running stack, and CI runs it on every change.

## Updating

Images are published by the **Images** workflow on every merge to `main` (tagged with the commit) and on version
tags (`v1.2.3`). To update, set `EMIS_TAG` in `.env` to the new tag and run:

```bash
docker compose --env-file .env -f compose.prod.yml pull
docker compose --env-file .env -f compose.prod.yml up -d
```

Pending migrations are applied automatically before the new API starts. Migrations only move forward, so **back
up before you update** (see below), and to go back to an older version restore the backup taken before the update.

## Checking an image is genuine

Every published image is signed by the build that made it and carries build provenance and an SBOM:

```bash
cosign verify ghcr.io/OWNER/emis-api:TAG \
  --certificate-identity-regexp 'https://github.com/OWNER/emis/.github/workflows/images.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Day to day

```bash
docker compose --env-file .env -f compose.prod.yml logs -f api worker    # what the system is doing
docker compose --env-file .env -f compose.prod.yml ps                    # what is running and healthy
docker compose --env-file .env -f compose.prod.yml restart worker        # restart one part
```

Data lives in Docker volumes (`postgres-data`, `valkey-data`, `caddy-data`). Do not run `docker compose down -v`:
the `-v` deletes them.

## Trying it without a domain

`infra/docker/compose.smoke.yml` adds a mail catcher so the stack can run on a laptop, and `smoke.sh` checks it.
See the comments at the top of that file and of `smoke.sh` for the settings (plain-http addresses on a spare port).
