#!/usr/bin/env bash
# Restores the database from an encrypted backup, replacing what is there now.
#
#   docker compose run --rm -v /path/to/age-key.txt:/run/age-key:ro backup restore emis-20260926T230000Z.dump.age --yes
#
# Stop the API and worker first. The private key (the file 'age-keygen' wrote) is only ever needed here.
source /usr/local/lib/emis/lib.sh

file="${1:-}"; confirm="${2:-}"
[ -n "$file" ] || die "usage: restore <backup file> --yes   (the file is looked up in $BACKUP_DIR)"
[ -f "$file" ] || file="$BACKUP_DIR/$file"
[ -f "$file" ] || die "no such backup: $1"
[ "$confirm" = "--yes" ] || die "this REPLACES the current database with the backup. Add --yes to go ahead."
[ -r /run/age-key ] || die "mount the private key at /run/age-key (read-only)"

wait_for_database
if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" >/dev/null) || die "the backup file is damaged (checksum mismatch)"
  log "checksum ok"
fi

plain="$SCRATCH_DIR/restore.dump"
trap 'rm -f "$plain"' EXIT
age -d -i /run/age-key -o "$plain" "$file" || die "could not decrypt: wrong key?"

others="$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" -d postgres)"
[ "$others" = 0 ] || log "note: $others connection(s) to $DB_NAME will be closed (stop the API and worker first)"

log "replacing $DB_NAME"
dropdb --if-exists --force "$DB_NAME"
# --create recreates the database with its owner, extensions, grants and everything else the dump holds.
pg_restore --create --exit-on-error -d postgres "$plain"
psql -qc 'ANALYZE' -d "$DB_NAME"
log "restored $(basename "$file"). Start the API and worker again."
