#!/usr/bin/env bash
# One image, several jobs: backup-loop, backup-once, offsite-loop, offsite-pull, restore, shell.
set -euo pipefail
cmd="${1:-backup-loop}"; shift || true
dir=/usr/local/lib/emis
case "$cmd" in
  backup-loop) exec "$dir/backup.sh" loop ;;
  backup-once) exec "$dir/backup.sh" once ;;
  offsite-loop) exec "$dir/offsite.sh" loop ;;
  offsite-once) exec "$dir/offsite.sh" once ;;
  offsite-pull) exec "$dir/offsite.sh" pull ;;
  restore) exec "$dir/restore.sh" "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
