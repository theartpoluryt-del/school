#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./.env
target_db=${APP_DB:-school}
source_dir=${1:?Usage: restore.sh import/TIMESTAMP}
test -f "$source_dir/school.sql"
test -f "$source_dir/accounts.sql"
(cd "$source_dir"; sha256sum -c SHA256SUMS)
# Refuse to import over a populated journal.
present=$(docker compose exec -T db psql -U postgres -d "$target_db" -Atc "select to_regclass('public.school_state') is not null")
test "$present" = f || { printf 'Target journal already exists. Refusing to overwrite it.\n' >&2; exit 1; }
# Start Auth first and wait for its schema migrations to finish, then stop it for restore.
docker compose up -d auth
ready=false
for attempt in $(seq 1 40); do
  if docker compose exec -T accounts node -e "fetch('http://auth:9999/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true || { printf 'Auth migrations are not ready\n' >&2; exit 1; }
docker compose stop auth rest accounts
docker compose exec -T db psql -U postgres -d "$target_db" -v ON_ERROR_STOP=1 --single-transaction < "$source_dir/accounts.sql"
docker compose exec -T db psql -U postgres -d "$target_db" -v ON_ERROR_STOP=1 --single-transaction < "$source_dir/school.sql"
docker compose exec -T db psql -U postgres -d "$target_db" -v ON_ERROR_STOP=1 < grants.sql
docker compose exec -T db psql -U postgres -d "$target_db" -v ON_ERROR_STOP=1 < compact-save.sql
if [ "${RESTORE_KEEP_STOPPED:-0}" != 1 ]; then
  docker compose up -d auth rest accounts
fi
printf 'Restored. Verify accounts, RLS and journal totals before starting the public web service.\n'
