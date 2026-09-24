#!/usr/bin/env bash
# Database security regression suite: self-contained runner.
#
#   bash supabase/tests/run.sh          (or: bun run test:db / npm run test:db)
#
# 1. Installs the stub extensions in supabase/tests/stubs (pgmq, supabase_vault,
#    pg_cron, pg_net: just enough SQL for the migrations to apply) into the
#    PostgreSQL 16 extension directory, using sudo when not root.
# 2. Starts a throwaway PostgreSQL 16 cluster in a temp dir (socket only, no
#    TCP port), as the postgres OS user when run as root, else as the caller.
# 3. Creates a fresh database, applies bootstrap.sql (Supabase-like roles, auth
#    schema, default privileges), then every supabase/migrations/*.sql in
#    filename order, each in one transaction with ON_ERROR_STOP. The first
#    failing migration is named and the run fails.
# 4. Runs security.sh against that database. Exit code 0 only if every
#    migration applied and every check passed.
#
# Env: PGBIN   PostgreSQL 16 bin dir (default /usr/lib/postgresql/16/bin)
#      DB      database name (default vt_security)
#      KEEP_DB=1 leave the cluster running and print how to connect
#      VT_TMP  parent dir for the throwaway cluster (default /tmp; keep it
#              short, unix socket paths are limited to ~100 characters)
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TESTS_DIR/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DB="${DB:-vt_security}"
PORT=5432

die() { echo "ERROR: $*" >&2; exit 1; }
[ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] && [ -x "$PGBIN/psql" ] \
  || die "PostgreSQL 16 server binaries not found in $PGBIN (apt-get install postgresql-16, or set PGBIN)"

IS_ROOT=0; [ "$(id -u)" = 0 ] && IS_ROOT=1
if [ "$IS_ROOT" = 1 ]; then
  id postgres >/dev/null 2>&1 || die "running as root needs a 'postgres' OS user (initdb refuses to run as root)"
  as_pg() { runuser -u postgres -- "$@"; }
else
  as_pg() { "$@"; }
fi

# --- 1. stub extensions ------------------------------------------------------
EXTDIR="$("$PGBIN/pg_config" --sharedir)/extension"
for src in "$TESTS_DIR"/stubs/*; do
  dest="$EXTDIR/$(basename "$src")"
  cmp -s "$src" "$dest" 2>/dev/null && continue
  if [ "$IS_ROOT" = 1 ]; then install -m 0644 "$src" "$dest"
  else sudo install -m 0644 "$src" "$dest"; fi
done

# --- 2. throwaway cluster ----------------------------------------------------
WORK="$(mktemp -d "${VT_TMP:-/tmp}/vtdb.XXXXXX")"
[ "$IS_ROOT" = 1 ] && chown postgres: "$WORK"
cleanup() {
  if [ "${KEEP_DB:-0}" = 1 ]; then
    echo "cluster kept: PGHOST=$WORK PGPORT=$PORT PGUSER=postgres $PGBIN/psql -d $DB"
    echo "stop it with: $([ "$IS_ROOT" = 1 ] && echo "runuser -u postgres -- ")$PGBIN/pg_ctl -D $WORK/data stop"
    return
  fi
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --no-locale >"$WORK/initdb.log" 2>&1 \
  || { cat "$WORK/initdb.log"; die "initdb failed"; }
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -w \
  -o "-p $PORT -k $WORK -c listen_addresses= -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  start >/dev/null || { cat "$WORK/server.log"; die "could not start PostgreSQL"; }

export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres
unset PGPASSWORD PGDATABASE PGSERVICE
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1)

# --- 3. fresh database + migrations -----------------------------------------
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$TESTS_DIR/bootstrap.sql" >/dev/null
n=0
for f in "$REPO"/supabase/migrations/*.sql; do
  n=$((n + 1))
  if ! out=$("${PSQL[@]}" -d "$DB" -1 -f "$f" 2>&1 >/dev/null); then
    echo "FAIL migration #$n $(basename "$f") does not apply on a fresh database:"
    grep -E "ERROR|DETAIL|HINT|CONTEXT|LINE|psql:" <<<"$out" | head -15 | sed 's/^/     | /'
    exit 1
  fi
done
echo "PASS applied $n migrations to a fresh database"

# --- 4. security suite -------------------------------------------------------
export DB REPO WORK PSQL_BIN="$PGBIN/psql"
bash "$TESTS_DIR/security.sh"
