#!/usr/bin/env bash
# One backup: dump, PROVE the dump restores, encrypt, keep. Then run again every night.
source /usr/local/lib/emis/lib.sh

DRILL_DB="${DB_NAME}_drill"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

# Restore the plain dump into a scratch database and compare it with the live one. A backup that has
# never been restored is only a hope; this makes every nightly backup a tested one.
drill() {
  local dump="$1"
  dropdb --if-exists --force "$DRILL_DB" >/dev/null 2>&1 || true
  createdb "$DRILL_DB"
  trap 'dropdb --if-exists --force "$DRILL_DB" >/dev/null 2>&1 || true' RETURN

  pg_restore --no-owner --no-acl --exit-on-error -d "$DRILL_DB" "$dump" \
    || die "the restore drill failed: this backup could NOT be restored"

  local tables='SELECT string_agg(table_schema || $$.$$ || table_name, $$,$$ ORDER BY table_schema, table_name)
                FROM information_schema.tables WHERE table_type = $$BASE TABLE$$ AND table_schema NOT IN ($$pg_catalog$$, $$information_schema$$)'
  [ "$(psql -Atqc "$tables" -d "$DB_NAME")" = "$(psql -Atqc "$tables" -d "$DRILL_DB")" ] \
    || die "the restore drill found different tables in the restored copy"

  local live restored
  live="$(psql -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations' -d "$DB_NAME")"
  restored="$(psql -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations' -d "$DRILL_DB")"
  [ "$live" = "$restored" ] || die "the restore drill found $restored applied migrations, expected $live"

  local accounts audit
  accounts="$(psql -Atqc 'SELECT count(*) FROM user_accounts' -d "$DRILL_DB")"
  audit="$(psql -Atqc 'SELECT count(*) FROM audit_log' -d "$DRILL_DB")"
  log "restore drill passed: $restored migrations, $accounts accounts, $audit audit entries in the restored copy"
  DRILL_ACCOUNTS="$accounts"
  DRILL_AUDIT="$audit"
}

prune_old() {
  # Keep KEEP_DAYS of backups, but never fewer than the 3 newest.
  local files=() f
  mapfile -t files < <(ls -1t "$BACKUP_DIR"/emis-*.dump.age 2>/dev/null || true)
  for f in "${files[@]:3}"; do
    if [ -n "$(find "$f" -mtime +"$KEEP_DAYS" 2>/dev/null)" ]; then
      rm -f "$f" "$f.sha256"
      log "removed old backup $(basename "$f")"
    fi
  done
}

run_backup() {
  recipient_args
  wait_for_database
  mkdir -p "$BACKUP_DIR" "$SCRATCH_DIR" "$STATUS_DIR"

  local ts plain out started
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  started="$(date -u +%FT%TZ)"
  plain="$SCRATCH_DIR/emis-$ts.dump"
  out="$BACKUP_DIR/emis-$ts.dump.age"
  trap 'rm -f "$plain" "$BACKUP_DIR/.emis-$ts.partial"' EXIT

  status_write backup "state=running" "started=$started" "last_success=$(status_get backup last_success)" "last_file=$(status_get backup last_file)"
  log "dumping $DB_NAME"
  pg_dump -Fc -d "$DB_NAME" -f "$plain"

  drill "$plain"

  age "${RECIPIENT_ARGS[@]}" -o "$BACKUP_DIR/.emis-$ts.partial" "$plain"
  mv "$BACKUP_DIR/.emis-$ts.partial" "$out"
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" >"$(basename "$out").sha256")
  rm -f "$plain"

  local size; size="$(stat -c %s "$out")"
  log "backup written: $(basename "$out") ($size bytes, encrypted)"
  status_write backup "state=ok" "last_success=$(date -u +%FT%TZ)" "last_file=$(basename "$out")" "size=$size" "accounts=$DRILL_ACCOUNTS" "audit_entries=$DRILL_AUDIT"
  prune_old
  trap - EXIT
}

# Seconds until the next HH:MM (UTC). Plain arithmetic: UTC has no daylight saving to get wrong.
seconds_until() {
  local hour="${1%%:*}" minute="${1##*:}" now target
  now="$(date -u +%s)"
  target=$((now - now % 86400 + 10#$hour * 3600 + 10#$minute * 60))
  [ "$target" -gt "$now" ] || target=$((target + 86400))
  echo $((target - now))
}

case "${1:-once}" in
  once) run_backup ;;
  loop)
    at="${BACKUP_AT:-23:00}"
    [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "BACKUP_AT must look like 23:00 (UTC)"
    log "backups: one now, then every day at $at UTC, keeping $KEEP_DAYS days"
    # A failed backup is reported and retried at the next slot; it never stops the loop.
    (run_backup) || { status_write backup "state=failed" "last_success=$(status_get backup last_success)" "last_file=$(status_get backup last_file)"; log "backup FAILED"; }
    while true; do
      sleep "$(seconds_until "$at")"
      (run_backup) || { status_write backup "state=failed" "last_success=$(status_get backup last_success)" "last_file=$(status_get backup last_file)"; log "backup FAILED"; }
    done
    ;;
  *) die "usage: backup.sh once|loop" ;;
esac
