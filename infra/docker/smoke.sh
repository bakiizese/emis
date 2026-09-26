#!/usr/bin/env bash
# Checks that a running production stack (compose.prod.yml, optionally with compose.smoke.yml) is
# healthy and locked down. Usage:
#
#   COMPOSE="docker compose --env-file .env -f compose.prod.yml -f compose.smoke.yml" \
#   WEB_HOST=web.localhost PORTAL_HOST=portal.localhost PORT=8081 ./smoke.sh
#
# WEB_HOST and PORTAL_HOST are the names Caddy answers to; PORT is where it listens. Names ending
# in .localhost are resolved to this machine by the script, so no /etc/hosts edits are needed.
set -euo pipefail

: "${COMPOSE:?set COMPOSE to your docker compose command}"
: "${WEB_HOST:?}" "${PORTAL_HOST:?}" "${PORT:?}"
SCHEME="${SCHEME:-http}"

pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok:   $*"; pass=$((pass + 1)); }
get() { # host path [extra curl args] -> prints "status" and leaves headers in /tmp/smoke.h, body in /tmp/smoke.b
  local host="$1" path="$2"; shift 2
  curl -s -o /tmp/smoke.b -D /tmp/smoke.h -w '%{http_code}' --resolve "$host:$PORT:127.0.0.1" "$@" "$SCHEME://$host:$PORT$path"
}

echo "Waiting for the stack (up to 3 minutes)..."
for _ in $(seq 1 90); do
  [ "$(get "$WEB_HOST" /robots.txt || true)" = 200 ] && break
  sleep 2
done
[ "$(get "$WEB_HOST" /robots.txt || true)" = 200 ] || { $COMPOSE ps; $COMPOSE logs --tail=40; fail "the website did not come up"; }
ok "website answers through Caddy"

[ "$(get "$PORTAL_HOST" /login)" = 200 ] || fail "portal sign-in page"
grep -qi "^content-security-policy:.*'nonce-" /tmp/smoke.h || fail "portal sends no nonce-based policy"
grep -qi "^x-content-type-options: nosniff" /tmp/smoke.h || fail "portal sends no nosniff"
ok "portal sign-in page, with a security policy"

[ "$(get "$WEB_HOST" /)" = 200 ] || fail "website home page"
grep -qi "^content-security-policy:.*frame-ancestors 'none'" /tmp/smoke.h || fail "website sends no framing rule"
ok "website home page, with a security policy"

for host in "$WEB_HOST" "$PORTAL_HOST"; do
  [ "$(get "$host" /api/v1/health/ready)" = 200 ] || fail "API not ready through $host"
done
ok "API reachable and ready on both addresses (/api routed by Caddy)"

[ "$(get "$PORTAL_HOST" /api/v1/users)" = 401 ] || fail "an unauthenticated request should get 401"
ok "protected routes refuse anonymous callers"

[ "$(get "$WEB_HOST" /api/v1/institution/public)" = 200 ] || fail "public profile"
grep -qi '"name"' /tmp/smoke.b || fail "public profile has no name"
ok "public profile served from the database"

if grep -qi '^server:' /tmp/smoke.h; then fail "Caddy is announcing its version in a Server header"; fi
ok "no Server header"

# Only Caddy may publish ports: the database, queue, PDF service and the apps stay inside the stack.
for service in postgres valkey gotenberg api worker web portal; do
  if [ -n "$(docker port "$($COMPOSE ps -q "$service")" 2>/dev/null)" ]; then fail "$service publishes a port on the host"; fi
done
ok "database, queue, PDF service and apps publish no ports"

# Only Caddy (certificates) and the worker (email) may reach the internet. If the worker can't either,
# this machine is offline and the check can't tell, so it says so instead of passing.
reaches_out() { $COMPOSE exec -T "$1" node -e "fetch('https://example.com',{signal:AbortSignal.timeout(6000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
if reaches_out worker; then
  for service in api web portal; do
    if reaches_out "$service"; then fail "$service can reach the internet"; fi
  done
  ok "the API and the apps have no route to the internet (only the worker and Caddy do)"
else
  echo "skip: this machine has no internet, so outbound isolation can't be checked"
fi
# The database, queue and PDF service must sit only on internal networks.
for service in postgres valkey gotenberg; do
  for network in $(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$($COMPOSE ps -q "$service")"); do
    [ "$(docker network inspect -f '{{.Internal}}' "$network")" = true ] || fail "$service is on $network, which has a route out"
  done
done
ok "database, queue and PDF service are on internal networks only"

[ -n "$($COMPOSE ps --status running -q worker)" ] || fail "the worker is not running"
ok "worker running"

migrated="$($COMPOSE logs migrate 2>&1 | grep -c 'database is up to date' || true)"
[ "$migrated" -ge 1 ] || fail "the migration did not report success"
ok "database roles created and migrations applied"

echo "All $pass checks passed."
