#!/bin/sh
set -eu
backup_root="/home/u394546085/domains/api.secondtales.com/hbuilds/backups/job-monitoring"
source_db="/home/u394546085/domains/api.secondtales.com/hbuilds/config/job-monitoring.sqlite"
mkdir -p "$backup_root"
chmod 700 "$backup_root"
if find "$backup_root" -name 'jobs-*.sqlite' -mmin -50 | grep -q .; then exit 0; fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_root/jobs-$stamp.sqlite"
umask 077
sqlite3 "$source_db" ".timeout 30000" ".backup '$backup_file'"
result=$(sqlite3 "$backup_file" 'PRAGMA integrity_check;')
[ "$result" = ok ] || { echo 'Backup integrity check failed' >&2; exit 1; }
find "$backup_root" -name 'jobs-*.sqlite' -type f -mtime +30 -delete
printf '%s backup verified\n' "$stamp" >> "$backup_root/backup.log"
