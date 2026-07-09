#!/bin/sh
set -e

# The durable transcription pipeline needs a Workflow world. Without it the API
# accepts videos and silently never processes them, so refuse to start.
if [ -z "$WORKFLOW_TARGET_WORLD" ] || [ -z "$WORKFLOW_POSTGRES_URL" ]; then
  echo "[entrypoint] FATAL: WORKFLOW_TARGET_WORLD and WORKFLOW_POSTGRES_URL must both be set."
  echo "[entrypoint]   WORKFLOW_TARGET_WORLD=@workflow/world-postgres"
  echo "[entrypoint]   WORKFLOW_POSTGRES_URL=postgresql://.../workflow?sslmode=require"
  exit 1
fi

# Create/upgrade the Workflow engine tables. Idempotent, safe on every start.
echo "[entrypoint] Setting up the Workflow Postgres world..."
n=0
until node node_modules/@workflow/world-postgres/bin/setup.js; do
  n=$((n + 1))
  if [ "$n" -ge 10 ]; then
    echo "[entrypoint] Workflow DB not ready after $n tries — giving up."
    exit 1
  fi
  echo "[entrypoint] Workflow DB not ready (attempt $n) — retrying in 3s..."
  sleep 3
done

# Schema. `db push` is a prototyping tool: it can drop columns on drift, keeps no
# history, and races across replicas. Production applies versioned migrations.
# Set RUN_DB_PUSH=true only for throwaway local databases.
if [ -n "$DATABASE_URL" ]; then
  if [ "${RUN_DB_PUSH:-false}" = "true" ]; then
    echo "[entrypoint] RUN_DB_PUSH=true — pushing schema (dev only)..."
    node_modules/.bin/prisma db push --skip-generate
  else
    echo "[entrypoint] Applying Prisma migrations..."
    n=0
    until node_modules/.bin/prisma migrate deploy; do
      n=$((n + 1))
      if [ "$n" -ge 10 ]; then
        echo "[entrypoint] Migrations failed after $n tries — giving up."
        exit 1
      fi
      echo "[entrypoint] Database not ready (attempt $n) — retrying in 3s..."
      sleep 3
    done
  fi
fi

echo "[entrypoint] Starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec node_modules/.bin/next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
