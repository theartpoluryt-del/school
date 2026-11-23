#!/bin/sh
set -eu
# Passwords are generated as hex, so they are safe SQL literals here.
case "$AUTH_DB_PASSWORD$REST_DB_PASSWORD" in *[!a-f0-9]*) exit 1;; esac
psql -v ON_ERROR_STOP=1 --username postgres --dbname school <<SQL
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE school_rest LOGIN NOINHERIT PASSWORD '$REST_DB_PASSWORD';
GRANT anon, authenticated, service_role TO school_rest;
CREATE ROLE school_auth LOGIN NOINHERIT PASSWORD '$AUTH_DB_PASSWORD';
CREATE SCHEMA auth AUTHORIZATION school_auth;
ALTER ROLE school_auth SET search_path = auth,extensions,public;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO school_auth, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
\$\$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid \$\$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
\$\$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) \$\$;
ALTER FUNCTION auth.uid() OWNER TO school_auth;
ALTER FUNCTION auth.jwt() OWNER TO school_auth;
SQL
