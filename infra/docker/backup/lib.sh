#!/usr/bin/env bash
# Shared helpers for the backup scripts.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
SCRATCH_DIR="${SCRATCH_DIR:-/scratch}"
STATUS_DIR="$BACKUP_DIR/status"
DB_NAME="${DB_NAME:-emis}"

export PGHOST="${PGHOST:-postgres}"
export PGUSER="${PGUSER:-postgres}"
export PGCONNECT_TIMEOUT=10
[ -n "${POSTGRES_ADMIN_PASSWORD:-}" ] && export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# A backup is never written unencrypted: refuse to run without a valid public key.
recipient_args() {
  local list="${BACKUP_AGE_RECIPIENT:-}" one
  [ -n "$list" ] || die "BACKUP_AGE_RECIPIENT is not set. Make a key pair with 'age-keygen', keep the private key OFF this server, and put the public key (age1...) in .env."
  RECIPIENT_ARGS=()
  IFS=',' read -ra keys <<<"$list"
  for one in "${keys[@]}"; do
    one="${one// /}"
    [[ "$one" =~ ^age1[a-z0-9]{50,}$ ]] || die "BACKUP_AGE_RECIPIENT contains something that is not an age public key (it must start with age1)."
    RECIPIENT_ARGS+=(-r "$one")
  done
}

# status_write <name> key=value...   writes /backups/status/<name>.json (numbers and simple words only)
status_write() {
  local name="$1"; shift
  mkdir -p "$STATUS_DIR"
  local json="{" first=1 pair
  for pair in "$@"; do
    [ $first = 1 ] || json+=","
    first=0
    json+="\"${pair%%=*}\":\"${pair#*=}\""
  done
  printf '%s}\n' "$json" >"$STATUS_DIR/$name.json.tmp"
  mv "$STATUS_DIR/$name.json.tmp" "$STATUS_DIR/$name.json"
}

# status_get <name> <key>   -> value, or empty
status_get() {
  [ -f "$STATUS_DIR/$1.json" ] || return 0
  sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" "$STATUS_DIR/$1.json"
}

epoch_of() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
hours_since() { echo $(( ($(date -u +%s) - $(epoch_of "$1")) / 3600 )); }

wait_for_database() {
  local tries=0
  until pg_isready -q -d postgres; do
    tries=$((tries + 1))
    [ $tries -lt 60 ] || die "the database did not become ready"
    sleep 2
  done
}
