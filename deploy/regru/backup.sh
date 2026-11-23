#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")"
. ./.env
target_db=${APP_DB:-school}
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="backups/school-$stamp.dump.part"
docker compose exec -T db pg_dump -U postgres -d "$target_db" -Fc > "$temporary"
test -s "$temporary"
mv "$temporary" "backups/school-$stamp.dump"
printf 'Backup saved: backups/school-%s.dump\n' "$stamp"
