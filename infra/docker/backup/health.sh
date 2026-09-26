#!/usr/bin/env bash
# Healthy means: a backup finished recently (backup service) or the newest one is offsite (offsite service).
source /usr/local/lib/emis/lib.sh

case "${1:-${HEALTH_FOR:-backup}}" in
  backup)
    last="$(status_get backup last_success)"
    [ -n "$last" ] || { echo "no successful backup yet"; exit 1; }
    [ "$(hours_since "$last")" -le "${BACKUP_MAX_AGE_HOURS:-30}" ] || { echo "last backup was $(hours_since "$last") hours ago"; exit 1; }
    ;;
  offsite)
    [ -n "${OFFSITE_PATH:-}" ] || { echo "OFFSITE_PATH is not set: backups are not leaving this server"; exit 1; }
    last="$(status_get offsite last_success)"
    [ -n "$last" ] || { echo "nothing copied offsite yet"; exit 1; }
    [ "$(hours_since "$last")" -le "${OFFSITE_MAX_AGE_HOURS:-3}" ] || { echo "last offsite copy was $(hours_since "$last") hours ago"; exit 1; }
    ;;
esac
