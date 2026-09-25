#!/bin/sh
# Nightly pg_dump of the svault database. Credentials come from bot/.env
# (same file the service uses); nothing secret lives in this script.
set -u
REPO=/home/main/projects/selenevault
BACKUP_DIR=/home/main/backups/svault
mkdir -p "$BACKUP_DIR"
set -a
# shellcheck disable=SC1091
. "$REPO/bot/.env"
set +a
STAMP=$(date +%F)
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_DIR/svault-$STAMP.dump" \
  && find "$BACKUP_DIR" -name 'svault-*.dump' -mtime +7 -delete \
  && echo "$STAMP backup ok"
