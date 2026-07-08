#!/bin/sh
set -e

# When self-hosting the Workflow engine on Postgres, create/upgrade its tables
# before booting. The migration is idempotent, so this is safe on every start.
# (On Vercel this env is unset and the managed world is used instead.)
if [ "$WORKFLOW_TARGET_WORLD" = "@workflow/world-postgres" ]; then
  echo "[entrypoint] Setting up the Workflow Postgres world..."
  n=0
  until node node_modules/@workflow/world-postgres/bin/setup.js; do
    n=$((n + 1))
    if [ "$n" -ge 10 ]; then
      echo "[entrypoint] Workflow DB not ready after $n tries — starting anyway."
      break
    fi
    echo "[entrypoint] Workflow DB not ready (attempt $n) — retrying in 3s..."
    sleep 3
  done
fi

echo "[entrypoint] Starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec node_modules/.bin/next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
