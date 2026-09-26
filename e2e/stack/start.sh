#!/usr/bin/env bash
# End-to-end test stack (LOCAL / CI ONLY, never production):
#
#   PostgreSQL 16 throwaway cluster  ->  bootstrap + every migration + seed.sql
#   PostgREST 12.2.3                 ->  the REST API (anon / authenticated / service_role)
#   gateway.mjs                      ->  the "Supabase URL": /rest/v1 proxy, Auth stub, Storage stub
#   vite dev (the real app, SSR)     ->  pointed at the gateway
#
#   bash e2e/stack/start.sh          (idempotent: stops and rebuilds a previous stack of the same name)
#   bash e2e/stack/stop.sh
#
# Parameters (environment variables, all optional):
#   E2E_DB            database name                        (default vt_e2e)
#   E2E_PG_PORT       PostgreSQL TCP port on 127.0.0.1      (default 54340)
#   E2E_GATEWAY_PORT  gateway port ("Supabase URL")         (default 54341)
#   E2E_PGRST_PORT    PostgREST port                        (default 54342)
#   E2E_APP_PORT      app (vite dev) port                   (default 8340)
#   E2E_RUN_DIR       runtime dir: cluster, logs, stack.env (default /tmp/vt-e2e/<db>)
#   PGBIN             PostgreSQL 16 bin dir                 (default /usr/lib/postgresql/16/bin)
#   POSTGREST_BIN     PostgREST binary (default e2e/.bin/postgrest, then $PATH, else downloaded)
#   E2E_NO_APP=1      start everything except the app (vite)
#
# Output: $E2E_RUN_DIR/stack.env (ports, URLs, JWT secret, anon + service-role keys;
# read by the Playwright helpers), *.log, mail.log (every auth e-mail link the
# stub "sends"), pids. Any failure prints the relevant log tails, stops what was
# started and exits non-zero.
set -Eeuo pipefail
MAIN_PID=$$

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$E2E_DIR/.." && pwd)"
STACK_DIR="$E2E_DIR/stack"

DB="${E2E_DB:-vt_e2e}"
PG_PORT="${E2E_PG_PORT:-54340}"
GATEWAY_PORT="${E2E_GATEWAY_PORT:-54341}"
PGRST_PORT="${E2E_PGRST_PORT:-54342}"
APP_PORT="${E2E_APP_PORT:-8340}"
RUN="${E2E_RUN_DIR:-/tmp/vt-e2e/$DB}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGRST_VERSION="12.2.3"
PGRST_URL="https://github.com/PostgREST/postgrest/releases/download/v${PGRST_VERSION}/postgrest-v${PGRST_VERSION}-linux-static-x64.tar.xz"
PGDATA_DIR="$RUN/pgdata"

log() { printf '[e2e-stack] %s\n' "$*"; }
die() { printf '[e2e-stack] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks ---
[[ "$DB" =~ ^[a-z_][a-z0-9_]{0,40}$ ]] || die "E2E_DB must match ^[a-z_][a-z0-9_]{0,40}\$ (got '$DB')"
for p in "$PG_PORT" "$GATEWAY_PORT" "$PGRST_PORT" "$APP_PORT"; do
  [[ "$p" =~ ^[0-9]{2,5}$ ]] || die "ports must be numbers (got '$p')"
done
[ "$(printf '%s\n' "$PG_PORT" "$GATEWAY_PORT" "$PGRST_PORT" "$APP_PORT" | sort -u | wc -l)" = 4 ] \
  || die "the four ports must differ"
[ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] && [ -x "$PGBIN/psql" ] \
  || die "PostgreSQL 16 server binaries not found in $PGBIN (apt-get install postgresql-16, or set PGBIN)"
command -v node >/dev/null || die "node is required"
command -v curl >/dev/null || die "curl is required"
[ -d "$E2E_DIR/node_modules/pg" ] || die "e2e dependencies missing: run 'npm ci' in $E2E_DIR"
if [ "${E2E_NO_APP:-0}" != 1 ]; then
  [ -x "$REPO/node_modules/.bin/vite" ] || die "app dependencies missing: run 'bun install' in $REPO"
fi

IS_ROOT=0; [ "$(id -u)" = 0 ] && IS_ROOT=1
if [ "$IS_ROOT" = 1 ]; then
  id postgres >/dev/null 2>&1 || die "running as root needs a 'postgres' OS user (initdb refuses to run as root)"
  as_pg() { runuser -u postgres -- "$@"; }
else
  as_pg() { "$@"; }
fi

# ------------------------------------------------ previous stack + ports ---
if [ -f "$RUN/pids" ] || [ -f "$PGDATA_DIR/postmaster.pid" ]; then
  log "stopping the previous '$DB' stack"
  E2E_RUN_DIR="$RUN" E2E_DB="$DB" bash "$STACK_DIR/stop.sh" >/dev/null 2>&1 || true
fi
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in "$PG_PORT" "$GATEWAY_PORT" "$PGRST_PORT" "$APP_PORT"; do
  port_busy "$p" && die "port $p on 127.0.0.1 is already in use (another stack? choose ports with E2E_*_PORT)"
done

# Refuse to wipe a directory that is not a stack run dir (E2E_RUN_DIR typo).
case "$RUN" in /*) ;; *) die "E2E_RUN_DIR must be an absolute path (got '$RUN')" ;; esac
if [ -d "$RUN" ] && [ -n "$(ls -A "$RUN" 2>/dev/null)" ] && [ ! -e "$RUN/.e2e-stack" ]; then
  die "$RUN exists and is not an e2e stack dir (no .e2e-stack marker); refusing to delete it"
fi
rm -rf "$RUN"
mkdir -p "$RUN"
touch "$RUN/.e2e-stack"
chmod 755 "$RUN"
: >"$RUN/pids"
: >"$RUN/mail.log"

# From here on, any failure prints the logs and stops what was started.
on_error() {
  local code=$? line=$1
  # A failing command substitution reports to the main shell; act only there.
  [ "$BASHPID" = "$MAIN_PID" ] || exit "$code"
  trap - ERR
  printf '\n[e2e-stack] FAILED (exit %s, line %s of start.sh)\n' "$code" "$line" >&2
  local f
  for f in "$RUN"/*.log; do
    [ -s "$f" ] || continue
    printf -- '----- %s (last 40 lines) -----\n' "$(basename "$f")" >&2
    tail -n 40 "$f" >&2
  done
  E2E_RUN_DIR="$RUN" E2E_DB="$DB" E2E_KEEP_LOGS=1 bash "$STACK_DIR/stop.sh" >/dev/null 2>&1 || true
  exit "$code"
}
trap 'on_error $LINENO' ERR

# wait_http <name> <url> <seconds> [pid]: until the URL answers 2xx/3xx; fails
# fast when the process behind it exits.
wait_http() {
  local name=$1 url=$2 secs=$3 pid=${4:-} i
  for ((i = 0; i < secs * 4; i++)); do
    if curl -fs -o /dev/null -m 5 "$url"; then return 0; fi
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "[e2e-stack] $name exited while starting" >&2
      return 1
    fi
    sleep 0.25
  done
  echo "[e2e-stack] $name did not answer at $url within ${secs}s" >&2
  return 1
}

# start_bg <name> <logfile> <cmd...>: own session/process group, so stop.sh can
# stop the process together with its children.
start_bg() {
  local name=$1 logfile=$2; shift 2
  setsid "$@" >"$logfile" 2>&1 < /dev/null &
  echo "$name $!" >>"$RUN/pids"
  LAST_PID=$!
}

# ------------------------------------------- 1. PostgreSQL 16 + schema ---
# Stub extensions (pgmq, supabase_vault, pg_cron, pg_net) exactly as the DB
# security suite installs them (supabase/tests/run.sh).
EXTDIR="$("$PGBIN/pg_config" --sharedir)/extension"
for src in "$REPO"/supabase/tests/stubs/*; do
  dest="$EXTDIR/$(basename "$src")"
  cmp -s "$src" "$dest" 2>/dev/null && continue
  if [ "$IS_ROOT" = 1 ]; then install -m 0644 "$src" "$dest"; else sudo install -m 0644 "$src" "$dest"; fi
done

log "initialising a PostgreSQL 16 cluster on 127.0.0.1:$PG_PORT ($PGDATA_DIR)"
mkdir -p "$PGDATA_DIR"
touch "$RUN/postgres.log"
if [ "$IS_ROOT" = 1 ]; then chown postgres: "$PGDATA_DIR" "$RUN/postgres.log"; fi
as_pg "$PGBIN/initdb" -D "$PGDATA_DIR" -A trust -U postgres -E UTF8 --no-locale >"$RUN/initdb.log" 2>&1
as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -l "$RUN/postgres.log" -w -t 60 \
  -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200" \
  start >/dev/null
echo "postgres pgctl" >>"$RUN/pids"

export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres
unset PGPASSWORD PGDATABASE PGSERVICE
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$REPO/supabase/tests/bootstrap.sql" >/dev/null
n=0
for f in "$REPO"/supabase/migrations/*.sql; do
  n=$((n + 1))
  if ! out=$("${PSQL[@]}" -d "$DB" -1 -f "$f" 2>&1 >/dev/null); then
    echo "[e2e-stack] migration #$n $(basename "$f") failed:" >&2
    grep -E "ERROR|DETAIL|HINT|CONTEXT|LINE|psql:" <<<"$out" | head -15 >&2
    false
  fi
done
log "applied $n migrations"

log "seeding sample data (e2e/stack/seed.sql)"
"${PSQL[@]}" -d "$DB" -f "$STACK_DIR/seed.sql" >"$RUN/seed.log" 2>&1
grep -E "seed ok" "$RUN/seed.log" | sed 's/^/[e2e-stack]   /'

# ------------------------------------------------------ 2. keys for this run ---
JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(36).toString("base64url"))')"
mkjwt() {
  node -e '
    const c = require("crypto"); const [role, secret] = process.argv.slice(1);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const h = b({ alg: "HS256", typ: "JWT" }), p = b({ iss: "supabase-e2e", ref: "e2e", role, iat: now, exp: now + 7 * 86400 });
    process.stdout.write(h + "." + p + "." + c.createHmac("sha256", secret).update(h + "." + p).digest("base64url"));
  ' "$1" "$JWT_SECRET"
}
ANON_KEY="$(mkjwt anon)"
SERVICE_ROLE_KEY="$(mkjwt service_role)"
APP_URL="http://127.0.0.1:$APP_PORT"
SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT"
cat >"$RUN/stack.env" <<EOF
E2E_DB=$DB
E2E_RUN_DIR=$RUN
APP_URL=$APP_URL
SUPABASE_URL=$SUPABASE_URL
PGRST_URL=http://127.0.0.1:$PGRST_PORT
DATABASE_URL=postgres://postgres@127.0.0.1:$PG_PORT/$DB
MAIL_LOG=$RUN/mail.log
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EOF

# ------------------------------------------------------------- 3. PostgREST ---
if [ -n "${POSTGREST_BIN:-}" ]; then
  PGRST_BIN="$POSTGREST_BIN"
elif [ -x "$E2E_DIR/.bin/postgrest" ]; then
  PGRST_BIN="$E2E_DIR/.bin/postgrest"
elif command -v postgrest >/dev/null 2>&1; then
  PGRST_BIN="$(command -v postgrest)"
else
  log "downloading PostgREST v$PGRST_VERSION into e2e/.bin"
  mkdir -p "$E2E_DIR/.bin"
  curl -fsSL --retry 3 -o "$RUN/postgrest.tar.xz" "$PGRST_URL"
  tar -xJf "$RUN/postgrest.tar.xz" -C "$E2E_DIR/.bin" postgrest
  rm -f "$RUN/postgrest.tar.xz"
  PGRST_BIN="$E2E_DIR/.bin/postgrest"
fi
PGRST_VERSION_OUT="$("$PGRST_BIN" --version 2>&1 || true)"
[[ "$PGRST_VERSION_OUT" == "PostgREST 12."* ]] \
  || { echo "[e2e-stack] $PGRST_BIN is not PostgREST 12.x: $PGRST_VERSION_OUT" >&2; false; }
cat >"$RUN/postgrest.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:$PG_PORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
db-pool = 20
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
log-level = "warn"
EOF
start_bg postgrest "$RUN/postgrest.log" "$PGRST_BIN" "$RUN/postgrest.conf"
wait_http postgrest "http://127.0.0.1:$PGRST_PORT/" 60 "$LAST_PID"
log "${PGRST_VERSION_OUT%%$'\n'*} on :$PGRST_PORT"

# --------------------------------------------------------------- 4. gateway ---
start_bg gateway "$RUN/gateway.log" env PORT="$GATEWAY_PORT" PGRST_URL="http://127.0.0.1:$PGRST_PORT" \
  JWT_SECRET="$JWT_SECRET" DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/$DB" \
  PUBLIC_URL="$SUPABASE_URL" DEFAULT_REDIRECT="$APP_URL/" RUN_DIR="$RUN" \
  node "$STACK_DIR/gateway.mjs"
wait_http gateway "$SUPABASE_URL/health" 30 "$LAST_PID"
log "gateway on :$GATEWAY_PORT (/rest/v1, /auth/v1, /storage/v1)"

# ------------------------------------------------------------------- 5. app ---
if [ "${E2E_NO_APP:-0}" != 1 ]; then
  cd "$REPO"
  # Process env wins over .env for Vite, so the app never sees the committed
  # production Supabase URL. LOVABLE_* are unset: no sandbox port overrides and
  # no transactional e-mail delivery (those rows simply stay queued).
  env -u LOVABLE_SANDBOX -u LOVABLE_API_KEY \
    VITE_SUPABASE_URL="$SUPABASE_URL" SUPABASE_URL="$SUPABASE_URL" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
    VITE_SUPABASE_PROJECT_ID="e2e" SUPABASE_PROJECT_ID="e2e" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    APP_ORIGIN="$APP_URL" PUBLIC_SITE_URL="$APP_URL" PUBLIC_APP_ORIGIN="$APP_URL" \
    APP_ALLOWED_ORIGINS="http://localhost:$APP_PORT" CRON_ALERTS_SECRET="e2e-cron-secret" \
    NODE_ENV=development BROWSER=none \
    setsid "$REPO/node_modules/.bin/vite" dev --port "$APP_PORT" --strictPort --host 127.0.0.1 \
    >"$RUN/vite.log" 2>&1 < /dev/null &
  echo "vite $!" >>"$RUN/pids"
  VITE_PID=$!
  cd - >/dev/null
  wait_http vite "$APP_URL/" 180 "$VITE_PID"
  # Server-side warm-up: the first request of each route compiles its modules.
  for route in / /auth /request-access /market /auth/update-password /portfolio /admin/investors; do
    curl -fs -o /dev/null -m 120 "$APP_URL$route" || true
  done
  log "app (vite dev) on :$APP_PORT"
fi

trap - ERR
cat <<EOF
[e2e-stack] up
  app       $APP_URL
  gateway   $SUPABASE_URL
  postgres  postgres://postgres@127.0.0.1:$PG_PORT/$DB
  env       $RUN/stack.env    logs: $RUN/*.log    mail links: $RUN/mail.log
EOF
