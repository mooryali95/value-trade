#!/usr/bin/env bash
# Stops the e2e stack started by start.sh (same E2E_DB / E2E_RUN_DIR):
# the app, the gateway, PostgREST and the throwaway PostgreSQL cluster, whose
# data directory is then deleted. Logs stay in the run dir.
#   E2E_KEEP_DB=1  stop PostgreSQL but keep its data directory
set -uo pipefail
DB="${E2E_DB:-vt_e2e}"
RUN="${E2E_RUN_DIR:-/tmp/vt-e2e/$DB}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
[ -d "$RUN" ] || { echo "[e2e-stack] nothing to stop ($RUN does not exist)"; exit 0; }

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

# Every background process was started with setsid: its pid is also its process
# group, so the whole group (vite's workers, etc.) goes down together.
if [ -f "$RUN/pids" ]; then
  while read -r name pid; do
    [[ "${pid:-}" =~ ^[0-9]+$ ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
      echo "[e2e-stack] stopped $name ($pid)"
    fi
  done <"$RUN/pids"
  for _ in $(seq 1 20); do
    alive=0
    while read -r _name pid; do
      [[ "${pid:-}" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && alive=1
    done <"$RUN/pids"
    [ "$alive" = 0 ] && break
    sleep 0.25
  done
  while read -r _name pid; do
    [[ "${pid:-}" =~ ^[0-9]+$ ]] || continue
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done <"$RUN/pids"
fi

if [ -f "$RUN/pgdata/postmaster.pid" ]; then
  as_pg "$PGBIN/pg_ctl" -D "$RUN/pgdata" -m fast -w -t 30 stop >/dev/null 2>&1 \
    || as_pg "$PGBIN/pg_ctl" -D "$RUN/pgdata" -m immediate stop >/dev/null 2>&1 || true
  echo "[e2e-stack] stopped postgres"
fi
[ "${E2E_KEEP_DB:-0}" = 1 ] || rm -rf "$RUN/pgdata"
rm -f "$RUN/pids"
exit 0
