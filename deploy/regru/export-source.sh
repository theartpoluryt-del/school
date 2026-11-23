#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")"
# .source-db.env contains PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE.
# Use the session pooler when the VPS has no outbound IPv6 connectivity.
set -a
. ./.source-db.env
set +a
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
export PGSSLMODE=verify-full
export PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$(pwd)/import/$stamp"
mkdir -p "$destination"
# pg_dump takes one consistent snapshot per dump. During FINAL export the old
# site's writes must already be stopped, including writes from old open tabs.
docker run --rm --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD --env PGDATABASE \
  --env PGSSLMODE --env PGSSLROOTCERT -v "$destination:/backup" postgres:17.11-alpine \
  pg_dump --clean --if-exists --no-owner --no-privileges --schema=public --schema=school_sync --schema=school_account \
    --file=/backup/school.sql
docker run --rm --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD --env PGDATABASE \
  --env PGSSLMODE --env PGSSLROOTCERT -v "$destination:/backup" postgres:17.11-alpine \
  pg_dump --data-only --schema=auth --exclude-table=auth.schema_migrations --file=/backup/accounts.sql
(cd "$destination"; sha256sum school.sql accounts.sql > SHA256SUMS)
printf 'Export complete: %s\n' "$destination"
