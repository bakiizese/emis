# Deploying EMIS

One institution, one server. Everything runs as containers behind Caddy, which gets and renews the
HTTPS certificates by itself.

## What you need

- A server with Docker (with the Compose plugin): 2 CPUs, 4 GB of memory and 40 GB of disk is plenty to start.
  A cloud VPS works; so does a machine in the institution's office if it has a fixed address, or a tunnel.
- Two names (for example `www.example.et` and `portal.example.et`) pointing at the server.
- Ports 80 and 443 (TCP, and 443 UDP for HTTP/3) open to the internet, plus 22 for you. **Nothing else.**
- An SMTP account for outgoing email (invitations, password resets, receipts, fee reminders).

## Backups: set this up before anything else

Every night the system dumps the database, **restores that dump into a scratch database to prove it works**, encrypts
it and keeps it for 14 days. A second service copies the encrypted files off the server. If the drill fails, the backup
is not kept and the failure shows in the logs and as an unhealthy container.

1. **Make a key pair on your own computer, not the server** (`age` is a small free tool: https://github.com/FiloSottile/age):

   ```bash
   age-keygen -o backup-key.txt
   ```

   It prints `Public key: age1...`. Put that public key in `.env` as `BACKUP_AGE_RECIPIENT`. Keep `backup-key.txt`
   (the private key) somewhere safe and **off the server**, next to your copy of `ENCRYPTION_KEY`. Backups are encrypted
   to the public key, so the server (and anyone who breaks into it, or into the offsite storage) can make backups but
   cannot read them. **Lose the private key and the backups are unreadable, by everyone.**

2. **Choose where the copies go** and copy `infra/docker/offsite.env.example` to `offsite.env` next to `compose.prod.yml`.
   Any S3-compatible storage works (Backblaze B2, Wasabi, Cloudflare R2, AWS S3), and so does another machine over SFTP.
   It must not be the same disk or the same server. The file explains the settings.
3. Start the stack as usual. The first backup is made a minute after start, then every night at `BACKUP_AT` (UTC).

Check it whenever you like:

```bash
docker compose --env-file .env -f compose.prod.yml ps                 # backup and offsite should say "healthy"
docker compose --env-file .env -f compose.prod.yml logs backup offsite
```

`backup` turns unhealthy if no backup has succeeded in 30 hours, and `offsite` if nothing has been copied in 3 hours (or
`offsite.env` is missing), so an uptime monitor watching container health will tell you before you need a backup that
isn't there. Old backups are pruned locally after `BACKUP_KEEP_DAYS`; set a lifecycle rule on the offsite bucket too.

**What is and isn't in a backup.** The database: every record, the audit log, and the queue of pending emails. Not in it:
sessions (people sign in again), Caddy's certificates (re-issued automatically), and your `.env` and keys (you keep those).

## Restoring after a disaster

This is the whole procedure for a lost server, a wiped disk or a corrupted database. It is exactly what CI rehearses on
every change (`infra/docker/dr-rehearsal.sh`), so it is known to work; still, **rehearse it yourself once, on a spare
machine, before you need it.**

You need: the `.env` and `offsite.env` files, and `backup-key.txt` (the private key).

1. On the new server put `compose.prod.yml`, `Caddyfile`, `.env` and `offsite.env` in a folder.
2. Bring up an empty database (this also creates its users and structure):

   ```bash
   docker compose --env-file .env -f compose.prod.yml up -d postgres valkey migrate
   ```

3. Fetch the backups from offsite, then restore the newest one (the file names sort by date):

   ```bash
   docker compose --env-file .env -f compose.prod.yml run --rm offsite offsite-pull
   docker compose --env-file .env -f compose.prod.yml run --rm backup ls /backups
   docker compose --env-file .env -f compose.prod.yml run --rm -v /path/to/backup-key.txt:/run/age-key:ro \
     backup restore emis-YYYYMMDDTHHMMSSZ.dump.age --yes
   ```

   It checks the file's checksum, decrypts it, replaces the database with the backup, and says so.

4. Start everything and sign in:

   ```bash
   docker compose --env-file .env -f compose.prod.yml up -d
   ```

Restoring on a server that is still running (for example after a bad update): stop the API and worker first
(`docker compose ... stop api worker`), run step 3 using a backup from the local `backups` volume (no need to `pull`),
then `up -d`.

Anything entered after the backup was taken is lost, which is why backups run nightly and offsite copies continue all day.

1. Copy `infra/docker/compose.prod.yml`, `infra/docker/Caddyfile` and `infra/docker/.env.prod.example` to a
   folder on the server (for example `/opt/emis`). The example file becomes `.env`.
2. Fill in `.env`. Every setting is explained in the file. Make each secret with `openssl rand -hex 24`, and
   the encryption key with `openssl rand -base64 32`.
   **Keep a copy of `ENCRYPTION_KEY` somewhere safe, apart from the server.** Without it the two-factor secrets
   stored in the database cannot be read.
   Also set up backups (next section) before you start: the stack will not start without a backup key.
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

Pending migrations are applied automatically before the new API starts. Migrations only move forward, so **take a
backup before you update** (`docker compose --env-file .env -f compose.prod.yml run --rm backup backup-once`), and to go
back to an older version restore that backup (see "Restoring after a disaster").

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

Data lives in Docker volumes (`postgres-data`, `valkey-data`, `backups`, `caddy-data`). Do not run `docker compose down -v`:
the `-v` deletes them.

## Trying it without a domain

`infra/docker/compose.smoke.yml` adds a mail catcher so the stack can run on a laptop, and `smoke.sh` checks it.
See the comments at the top of that file and of `smoke.sh` for the settings (plain-http addresses on a spare port).
