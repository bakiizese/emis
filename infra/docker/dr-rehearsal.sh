#!/usr/bin/env bash
# The disaster drill: proves that a backup taken from a running stack, and nothing else but the private key,
# is enough to bring the whole system back on a brand-new server. It is the executable version of
# "Restoring after a disaster" in docs/deployment.md, and CI runs it on every change.
#
#   COMPOSE="docker compose -p emis-smoke --env-file .env -f compose.prod.yml -f compose.smoke.yml" \
#   PROJECT=emis-smoke AGE_KEY_FILE=/path/to/age-key.txt WEB_HOST=web.localhost PORTAL_HOST=portal.localhost PORT=8081 \
#   ./dr-rehearsal.sh
#
# It starts from a running stack (smoke.sh's), adds some data, backs up, DESTROYS the database, queue and local
# backups, rebuilds from the offsite copy, and checks the data and the sign-in came back.
set -euo pipefail

: "${COMPOSE:?}" "${PROJECT:?}" "${AGE_KEY_FILE:?}" "${WEB_HOST:?}" "${PORTAL_HOST:?}" "${PORT:?}"
step() { echo; echo "== $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
sql() { $COMPOSE exec -T postgres psql -U postgres -d emis -Atqc "$1"; }
login_status() { curl -s -o /dev/null -w '%{http_code}' --resolve "$PORTAL_HOST:$PORT:127.0.0.1" -X POST \
  "http://$PORTAL_HOST:$PORT/api/v1/auth/login" -H "Origin: http://$PORTAL_HOST:$PORT" -H 'content-type: application/json' \
  -d '{"email":"drill-owner@example.test","password":"correct-horse-battery-staple-91"}'; }

step "1. Put real data in the system"
for who in drill-owner drill-deputy; do
  $COMPOSE exec -T -e ADMIN_EMAIL="$who@example.test" -e ADMIN_NAME="Drill ${who#drill-}" \
    -e ADMIN_PASSWORD="correct-horse-battery-staple-91" api node dist/cli/create-admin.js >/dev/null
done
[ "$(login_status)" = 200 ] || fail "could not sign in before the disaster"
before_accounts="$(sql 'SELECT count(*) FROM user_accounts')"
before_audit="$(sql 'SELECT count(*) FROM audit_log')"
echo "before: $before_accounts accounts, $before_audit audit entries"
[ "$before_accounts" -ge 2 ] || fail "the drill's accounts were not created"

step "2. Back up, and copy it offsite"
$COMPOSE run --rm backup backup-once
$COMPOSE run --rm offsite offsite-once
file="$($COMPOSE run --rm --entrypoint sh backup -c 'ls -1t /backups/emis-*.dump.age | head -1 | xargs basename')"
file="$(echo "$file" | tr -d '\r')"
[ -n "$file" ] || fail "no backup file found"
echo "backup: $file"

step "3. Disaster: destroy the database, the queue and the local backups"
$COMPOSE down 2>&1 | tail -1
for volume in postgres-data valkey-data backups; do
  docker volume rm "${PROJECT}_${volume}" >/dev/null || fail "could not remove $volume"
done
echo "gone: postgres-data, valkey-data, backups (only the offsite copy and the private key remain)"

step "4. A new server: empty database, then fetch the backup from offsite"
$COMPOSE up -d postgres valkey migrate
for _ in $(seq 1 60); do
  [ "$($COMPOSE ps -a --format '{{.State}}' migrate 2>/dev/null)" = exited ] && break
  sleep 2
done
[ "$(sql 'SELECT count(*) FROM user_accounts')" = 0 ] || fail "the new server should start empty"
$COMPOSE run --rm offsite offsite-pull

step "5. Restore with the private key"
$COMPOSE run --rm -v "$AGE_KEY_FILE:/run/age-key:ro" backup restore "$file" --yes

step "6. Start everything and check what came back"
$COMPOSE up -d
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --resolve "$PORTAL_HOST:$PORT:127.0.0.1" "http://$PORTAL_HOST:$PORT/api/v1/health/ready" || true)" = 200 ] && break
  sleep 2
done
after_accounts="$(sql 'SELECT count(*) FROM user_accounts')"
after_audit="$(sql 'SELECT count(*) FROM audit_log')"
echo "after:  $after_accounts accounts, $after_audit audit entries"
[ "$after_accounts" = "$before_accounts" ] || fail "accounts: expected $before_accounts, got $after_accounts"
[ "$after_audit" -ge "$before_audit" ] || fail "audit entries went missing: expected at least $before_audit, got $after_audit"
[ "$(login_status)" = 200 ] || fail "could not sign in after the restore"
echo "signed in as the restored administrator"

echo; echo "Disaster drill passed: the system came back from the offsite backup alone."
