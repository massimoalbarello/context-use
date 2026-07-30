#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${NANGO_DB_PASSWORD:?NANGO_DB_PASSWORD is required}"
: "${NANGO_BACKUP_DB_PASSWORD:?NANGO_BACKUP_DB_PASSWORD is required}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

# Nango owns its database because its upstream migrations create and evolve
# several schemas. The Context Use roles receive no CONNECT grant, while the
# backup identity receives only read privileges inside this database.
psql -X -v ON_ERROR_STOP=1 \
  --host "${PGHOST}" --port "${PGPORT}" --username postgres --dbname postgres \
  --set=nango_password="${NANGO_DB_PASSWORD}" \
  --set=nango_backup_password="${NANGO_BACKUP_DB_PASSWORD}" <<'SQL'
SELECT format(
  'CREATE ROLE nango_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'nango_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nango_app')
\gexec

SELECT format(
  'CREATE ROLE nango_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'nango_backup_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nango_backup')
\gexec

ALTER ROLE nango_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'nango_password';
ALTER ROLE nango_backup
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'nango_backup_password';
ALTER ROLE nango_app SET search_path=nango,public;
ALTER ROLE nango_backup SET search_path=nango,public;

SELECT 'CREATE DATABASE nango OWNER nango_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='nango')
\gexec

ALTER DATABASE nango OWNER TO nango_app;
REVOKE ALL ON DATABASE nango FROM PUBLIC;
GRANT CONNECT,TEMPORARY ON DATABASE nango TO nango_app;
GRANT CONNECT ON DATABASE nango TO nango_backup;

-- Keep the existing Context Use database boundary explicit even if this script
-- is run outside the normal post-migration deployment sequence.
REVOKE CONNECT,TEMPORARY,CREATE ON DATABASE context_use FROM PUBLIC;
REVOKE CONNECT ON DATABASE context_use FROM nango_app,nango_backup;
SQL

psql -X -v ON_ERROR_STOP=1 \
  --host "${PGHOST}" --port "${PGPORT}" --username postgres --dbname nango <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nango_app,nango_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE nango_app
  GRANT USAGE ON SCHEMAS TO nango_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE nango_app
  GRANT SELECT ON TABLES TO nango_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE nango_app
  GRANT USAGE,SELECT ON SEQUENCES TO nango_backup;

SELECT format('GRANT USAGE ON SCHEMA %I TO nango_backup', nspname)
FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
\gexec

SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO nango_backup', nspname)
FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
\gexec

SELECT format('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA %I TO nango_backup', nspname)
FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
\gexec
SQL
