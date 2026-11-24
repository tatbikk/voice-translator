#!/usr/bin/env bash
# CI only: creates the owner role and the databases on the disposable PostgreSQL
# service, then exports the configuration of one run, with secrets generated for
# that run alone and masked in the logs (nothing secret is stored in the
# repository or the workflow).
#   usage: ci-database.sh <database name> <APP_URL>
set -euo pipefail
database="$1"
app_url="$2"

owner_password="$(openssl rand -hex 24)"
app_password="$(openssl rand -hex 24)"
session_secret="$(openssl rand -base64 48)"
master_key="$(openssl rand -base64 32)"
access_code="$(openssl rand -hex 16)"
seed_password="$(openssl rand -hex 12)"
for value in "$owner_password" "$app_password" "$session_secret" "$master_key" "$access_code" "$seed_password"; do
  echo "::add-mask::$value"
done

PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres OWNER_PASSWORD="$owner_password" bash scripts/local-db-setup.sh

{
  echo "APP_MODE=demo"
  echo "DEMO_TOOLS=true"
  echo "AI_EXTERNAL_ALLOWED=false"
  echo "APP_URL=$app_url"
  echo "MIGRATION_DATABASE_URL=postgresql://mahkama:${owner_password}@localhost:5432/${database}"
  echo "DATABASE_URL=postgresql://mahkama_app:${app_password}@localhost:5432/${database}"
  echo "APP_DB_PASSWORD=${app_password}"
  echo "SESSION_SECRET=${session_secret}"
  echo "SECRETS_MASTER_KEY=${master_key}"
  echo "ACCESS_CODE=${access_code}"
  echo "SEED_DEMO_PASSWORD=${seed_password}"
} >> "$GITHUB_ENV"
