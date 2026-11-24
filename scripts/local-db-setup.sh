#!/usr/bin/env bash
# Local PostgreSQL setup for development and tests. Run once, as the PostgreSQL
# superuser, for example:  sudo -u postgres bash scripts/local-db-setup.sh
#
# It creates the OWNER role (used for migrations, role provisioning and seed)
# and the development, test and end-to-end databases it owns. The RUNTIME role
# is not created here: `npm run db:roles` creates it with the owner connection,
# so that the owner holds the admin option on it (PostgreSQL 16+).
#
# Passwords are read from the environment and never written to the repository:
#   OWNER_PASSWORD   password of the owner role "mahkama"
set -euo pipefail

: "${OWNER_PASSWORD:?set OWNER_PASSWORD}"

psql -v ON_ERROR_STOP=1 -v owner_password="$OWNER_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE mahkama LOGIN CREATEDB CREATEROLE PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mahkama') \gexec
SELECT format('ALTER ROLE mahkama LOGIN CREATEDB CREATEROLE PASSWORD %L', :'owner_password') \gexec
SQL

for db in mahkama_dev mahkama_test mahkama_e2e; do
  if ! psql -Atc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    createdb -O mahkama "$db"
  fi
done

echo "Owner role and databases ready. Next, from apps/web: npm run db:migrate && npm run db:roles"
