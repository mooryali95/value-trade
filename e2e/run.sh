#!/usr/bin/env bash
# Runs the end-to-end journeys: fresh stack -> Playwright -> stack stopped (always).
#
#   npm run test:e2e                          (repo root)
#   bash e2e/run.sh [playwright args...]      e.g. bash e2e/run.sh tests/trading.spec.ts --headed
#
# Env: everything e2e/stack/start.sh takes (E2E_DB, E2E_PG_PORT, E2E_GATEWAY_PORT,
# E2E_PGRST_PORT, E2E_APP_PORT, E2E_RUN_DIR, PGBIN, POSTGREST_BIN), plus
#   E2E_KEEP_STACK=1   leave the stack running afterwards (stop it with bash e2e/stack/stop.sh)
# Artifacts (traces, screenshots and videos of failures, HTML report, JUnit
# XML, stack logs) are written to e2e/artifacts/.
set -Eeuo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export E2E_DB="${E2E_DB:-vt_e2e}"
export E2E_RUN_DIR="${E2E_RUN_DIR:-/tmp/vt-e2e/$E2E_DB}"
export E2E_STACK_ENV="$E2E_RUN_DIR/stack.env"
ARTIFACTS="$E2E_DIR/artifacts"

cd "$E2E_DIR"
if [ ! -d node_modules/@playwright/test ] || [ ! -d node_modules/pg ]; then
  echo "[e2e] installing the e2e dependencies (npm ci)"
  npm ci --no-audit --no-fund
fi

finish() {
  local code=$?
  trap - EXIT INT TERM
  # Stack logs next to the Playwright artifacts (CI uploads them on failure).
  mkdir -p "$ARTIFACTS/stack-logs"
  cp "$E2E_RUN_DIR"/*.log "$ARTIFACTS/stack-logs/" 2>/dev/null || true
  if [ "${E2E_KEEP_STACK:-0}" = 1 ]; then
    echo "[e2e] stack left running (E2E_KEEP_STACK=1); stop it with: bash e2e/stack/stop.sh"
  else
    bash "$E2E_DIR/stack/stop.sh" || true
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rm -rf "$ARTIFACTS/test-results" "$ARTIFACTS/html-report" "$ARTIFACTS/stack-logs" "$ARTIFACTS/junit.xml"
bash "$E2E_DIR/stack/start.sh"
npx playwright test "$@"
