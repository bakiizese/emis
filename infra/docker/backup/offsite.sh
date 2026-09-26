#!/usr/bin/env bash
# Copies the encrypted backups to somewhere that is not this server. Only encrypted files ever leave.
#
# The destination is an rclone remote named "offsite", configured with environment variables, e.g. for
# S3-compatible storage:
#   RCLONE_CONFIG_OFFSITE_TYPE=s3  RCLONE_CONFIG_OFFSITE_PROVIDER=Other
#   RCLONE_CONFIG_OFFSITE_ENDPOINT=https://...  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...
#   RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...  OFFSITE_PATH=my-bucket/emis
# (see https://rclone.org/docs/ for SFTP, Backblaze B2, Google Drive and others)
source /usr/local/lib/emis/lib.sh

remote() { echo "offsite:${OFFSITE_PATH:?set OFFSITE_PATH (for example my-bucket/emis)}"; }

push() {
  mkdir -p "$STATUS_DIR"
  # Only finished, encrypted backups; never the partial file being written or anything else.
  rclone copy "$BACKUP_DIR" "$(remote)" --include 'emis-*.dump.age' --include 'emis-*.dump.age.sha256' --ignore-existing --no-traverse
  local newest; newest="$(ls -1t "$BACKUP_DIR"/emis-*.dump.age 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ]; then
    rclone check "$BACKUP_DIR" "$(remote)" --one-way --size-only --include "$(basename "$newest")" >/dev/null \
      || die "the copy of $(basename "$newest") offsite does not match"
  fi
  status_write offsite "state=ok" "last_success=$(date -u +%FT%TZ)" "last_file=$(basename "${newest:-none}")"
  log "offsite copy is up to date ($(basename "${newest:-none}"))"
}

case "${1:-loop}" in
  once) push ;;
  loop)
    [ -n "${OFFSITE_PATH:-}" ] || log "WARNING: OFFSITE_PATH is not set, so backups are NOT leaving this server. Set it (see .env)."
    while true; do
      if [ -n "${OFFSITE_PATH:-}" ]; then
        (push) || { status_write offsite "state=failed" "last_success=$(status_get offsite last_success)" "last_file=$(status_get offsite last_file)"; log "offsite copy FAILED, will retry"; }
      fi
      sleep "${OFFSITE_EVERY_SECONDS:-900}"
    done
    ;;
  pull)
    # Disaster recovery on a new server: fetch every backup from offsite into the local backup folder.
    mkdir -p "$BACKUP_DIR"
    rclone copy "$(remote)" "$BACKUP_DIR" --include 'emis-*.dump.age' --include 'emis-*.dump.age.sha256'
    log "fetched: $(ls -1 "$BACKUP_DIR"/emis-*.dump.age 2>/dev/null | wc -l) backup(s)"
    ;;
  *) die "usage: offsite.sh loop|once|pull" ;;
esac
