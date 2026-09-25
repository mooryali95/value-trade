#!/usr/bin/env bash
# Regression test for supabase/ops/launch_bundle.sql (built by
# build_launch_bundle.sh).
#
#   bash supabase/ops/test_launch_bundle.sh
#
# Self-contained, like supabase/tests/run.sh: installs the stub extensions,
# starts a throwaway PostgreSQL 16 cluster (socket only), and then:
#   1. builds a PRODUCTION-LIKE database: bootstrap + every migration BEFORE
#      20260924 + realistic legacy rows (100,000 default balances with no
#      ledger, fractional and legacy-status orders, trades and positions with
#      no issuance, the 276 published seeded instruments, several Shariah
#      rulings per symbol, a legacy one-step approval, pending invitations
#      and access requests, alerts, watchers) + a Supabase-style migration
#      history (supabase_migrations.schema_migrations);
#   2. applies the bundle as the owner would (psql -f, ON_ERROR_STOP; the
#      bundle is its own transaction);
#   3. checks: the schema equals a database built migration by migration;
#      the history lists every bundled version; the data is coherent
#      (cash = ledger, no resting order on an unpublished instrument,
#      nothing listed without an admin price and a ruling, no invented
#      rulings, users / companies / invitations / requests kept); the
#      integrity report runs; the lifecycle and the engine work;
#   4. a second run is refused with LAUNCH_BUNDLE_ALREADY_APPLIED and
#      changes nothing;
#   5. supabase/ops/go_live_reset.sql then runs and leaves every integrity
#      check green (legacy units with no issuance are archived and cleared).
# Env: PGBIN (default /usr/lib/postgresql/16/bin), KEEP_DB=1 keeps the cluster,
#      VT_TMP parent dir of the cluster (default /tmp), NO_BUILD=1 tests the
#      committed bundle as is (default: rebuild it first).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TESTS_DIR="$REPO/supabase/tests"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BUNDLE="$HERE/launch_bundle.sql"
FIRST="20260924100000"
PORT=5432
die() { echo "ERROR: $*" >&2; exit 1; }
[ -x "$PGBIN/initdb" ] || die "PostgreSQL 16 server binaries not found in $PGBIN"

if [ "${NO_BUILD:-0}" != 1 ]; then bash "$HERE/build_launch_bundle.sh" >/dev/null || die "bundle build failed"; fi
[ -f "$BUNDLE" ] || die "$BUNDLE not found (run build_launch_bundle.sh)"

IS_ROOT=0; [ "$(id -u)" = 0 ] && IS_ROOT=1
if [ "$IS_ROOT" = 1 ]; then as_pg() { runuser -u postgres -- "$@"; }; else as_pg() { "$@"; }; fi
EXTDIR="$("$PGBIN/pg_config" --sharedir)/extension"
for src in "$TESTS_DIR"/stubs/*; do
  dest="$EXTDIR/$(basename "$src")"
  cmp -s "$src" "$dest" 2>/dev/null && continue
  if [ "$IS_ROOT" = 1 ]; then install -m 0644 "$src" "$dest"; else sudo install -m 0644 "$src" "$dest"; fi
done
WORK="$(mktemp -d "${VT_TMP:-/tmp}/vtlb.XXXXXX")"
[ "$IS_ROOT" = 1 ] && chown postgres: "$WORK"
cleanup() {
  if [ "${KEEP_DB:-0}" = 1 ]; then echo "cluster kept: PGHOST=$WORK PGPORT=$PORT PGUSER=postgres (databases vt_prod, vt_ref)"; return; fi
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --no-locale >"$WORK/initdb.log" 2>&1 || { cat "$WORK/initdb.log"; die "initdb failed"; }
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -w \
  -o "-p $PORT -k $WORK -c listen_addresses= -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null \
  || { cat "$WORK/server.log"; die "could not start PostgreSQL"; }
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres
unset PGPASSWORD PGDATABASE PGSERVICE

PASS=0; FAIL=0; FAILED=()
P=("$PGBIN/psql" -X -q -At -v ON_ERROR_STOP=1)
su() { "${P[@]}" -d vt_prod -c "$1" 2>&1; }
svc() { printf 'BEGIN;\nSET LOCAL ROLE service_role;\n%s\nCOMMIT;\n' "$1" | "${P[@]}" -d vt_prod 2>&1; }
as_user() {
  local pre="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',true);"
  printf 'BEGIN;\n\\o /dev/null\n%s\n\\o\n%s\nCOMMIT;\n' "$pre" "$2" | "${P[@]}" -d vt_prod 2>&1
}
check() { if [ "$2" == "$3" ]; then PASS=$((PASS + 1)); echo "  PASS $1"; else FAIL=$((FAIL + 1)); FAILED+=("$1"); echo "  FAIL $1"; printf '       | expected [%s]\n       | got      [%s]\n' "$3" "$2" | head -12; fi; }
newdb() { "${P[@]}" -d postgres -c "CREATE DATABASE $1" >/dev/null && "${P[@]}" -d "$1" -f "$TESTS_DIR/bootstrap.sql" >/dev/null; }
apply_range() { # apply_range <db> <from> <to-exclusive>: each migration in its own transaction
  local f b
  for f in "$REPO"/supabase/migrations/*.sql; do
    b=$(basename "$f")
    [[ "$b" < "$2" ]] && continue
    [ -n "$3" ] && [[ ! "$b" < "$3" ]] && continue
    "${P[@]}" -d "$1" -1 -f "$f" >/dev/null 2>"$WORK/mig.err" || { echo "migration $b failed on $1:"; head -5 "$WORK/mig.err"; return 1; }
  done
}

echo "== 1. production-like database (migrations before $FIRST + legacy rows)"
newdb vt_prod || die "createdb failed"
apply_range vt_prod "" "$FIRST" || die "pre-launch migrations failed"
"${P[@]}" -d vt_prod >/dev/null 2>"$WORK/legacy.err" <<'SQL' || { cat "$WORK/legacy.err"; die "legacy fixtures failed"; }
-- Supabase-style migration history with the pre-launch versions applied.
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT split_part(f, '_', 1), regexp_replace(f, '^[0-9]+_|\.sql$', '', 'g')
  FROM (VALUES ('20260709030055_initial.sql')) v(f);

CREATE TEMP TABLE u (k text PRIMARY KEY, id uuid);
INSERT INTO auth.users (email, email_confirmed_at) VALUES
  ('legacy-admin@example.test', now()), ('legacy-board@example.test', now()), ('legacy-owner@example.test', now()),
  ('legacy-inv1@example.test', now()), ('legacy-inv2@example.test', now()), ('legacy-inv3@example.test', NULL);
INSERT INTO u SELECT split_part(split_part(email, '@', 1), '-', 2), id FROM auth.users WHERE email LIKE 'legacy-%';
-- handle_new_user made everyone a trader; operators got their roles by hand.
INSERT INTO public.user_roles (user_id, role) SELECT id, 'platform_admin' FROM u WHERE k = 'admin';
INSERT INTO public.user_roles (user_id, role) SELECT id, 'shariah_board' FROM u WHERE k = 'board';

-- Balances: the old default of 100,000 with no ledger at all; one investor
-- traded (balance moved, still no ledger).
INSERT INTO public.portfolios (user_id) SELECT id FROM u WHERE k IN ('inv1', 'inv2', 'inv3', 'owner');
UPDATE public.portfolios SET cash_balance = 99850.50 WHERE user_id = (SELECT id FROM u WHERE k = 'inv1');
UPDATE public.portfolios SET cash_balance = 100149.50 WHERE user_id = (SELECT id FROM u WHERE k = 'inv2');

-- Several rulings per symbol on seeded instruments.
CREATE TEMP TABLE s AS SELECT symbol, row_number() OVER (ORDER BY symbol) AS n FROM public.brands WHERE published ORDER BY symbol LIMIT 3;
INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, created_at)
SELECT symbol, st, 'legacy ruling', (SELECT id FROM u WHERE k = 'board'), ts
  FROM s, LATERAL (VALUES ('halal', now() - interval '30 days'), ('non_halal', now() - interval '10 days')) x(st, ts)
 WHERE n = 1;
INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, created_at)
SELECT symbol, st, 'legacy ruling', (SELECT id FROM u WHERE k = 'board'), ts
  FROM s, LATERAL (VALUES ('reviewing', now() - interval '20 days'), ('halal', now() - interval '5 days')) x(st, ts)
 WHERE n = 2;

-- Legacy orders on the first seeded symbol: a fractional resting buy, a
-- 'pending' (old default status) order, a filled pair with its trade, a
-- partial.
INSERT INTO public.orders (id, user_id, symbol, side, type, qty, price, status, filled_qty, filled_price, filled_at) VALUES
  ('00000000-0000-4000-8000-00000000f001', (SELECT id FROM u WHERE k = 'inv1'), (SELECT symbol FROM s WHERE n = 2), 'buy',  'limit', 1.5, 99, 'open', 0, NULL, NULL),
  ('00000000-0000-4000-8000-00000000f002', (SELECT id FROM u WHERE k = 'inv3'), (SELECT symbol FROM s WHERE n = 2), 'sell', 'limit', 3, 120, 'pending', 0, NULL, NULL),
  ('00000000-0000-4000-8000-00000000f003', (SELECT id FROM u WHERE k = 'inv1'), (SELECT symbol FROM s WHERE n = 2), 'buy',  'limit', 1.5, 99.67, 'filled', 1.5, 99.67, now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000f004', (SELECT id FROM u WHERE k = 'inv2'), (SELECT symbol FROM s WHERE n = 2), 'sell', 'limit', 1.5, 99.67, 'filled', 1.5, 99.67, now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000f005', (SELECT id FROM u WHERE k = 'inv2'), (SELECT symbol FROM s WHERE n = 3), 'sell', 'limit', 10, 101, 'partial', 4, 101, NULL);
INSERT INTO public.trades (symbol, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id, created_at) VALUES
  ((SELECT symbol FROM s WHERE n = 2), 1.5, 99.67, '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000f004',
   (SELECT id FROM u WHERE k = 'inv1'), (SELECT id FROM u WHERE k = 'inv2'), now() - interval '3 days');
-- Positions with no issuance behind them (units appeared from nowhere).
INSERT INTO public.positions (user_id, symbol, qty, avg_price) VALUES
  ((SELECT id FROM u WHERE k = 'inv1'), (SELECT symbol FROM s WHERE n = 2), 1.5, 99.67),
  ((SELECT id FROM u WHERE k = 'inv2'), (SELECT symbol FROM s WHERE n = 3), 10.5, 100);

-- A company, a legacy one-step approval (published at the default price,
-- no ruling), a pending submission, invitations and access requests.
INSERT INTO public.companies (id, slug, name_ar, name_en, created_by)
VALUES ('00000000-0000-4000-8000-0000000c0001', 'legacy-co', 'شركة قديمة', 'Legacy Co', (SELECT id FROM u WHERE k = 'owner'));
INSERT INTO public.company_members (company_id, user_id, role)
SELECT '00000000-0000-4000-8000-0000000c0001', id, 'owner' FROM u WHERE k = 'owner'
ON CONFLICT DO NOTHING;
INSERT INTO public.product_submissions (id, company_id, submitted_by, asset_class, symbol, name_ar, name_en, status, reviewer_id, reviewed_at) VALUES
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000c0001', (SELECT id FROM u WHERE k = 'owner'), 'brand', 'LEGX', 'منتج قديم', 'Legacy X', 'approved', (SELECT id FROM u WHERE k = 'board'), now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000c0001', (SELECT id FROM u WHERE k = 'owner'), 'brand', 'LEGY', 'منتج جديد', 'Legacy Y', 'pending', NULL, NULL);
INSERT INTO public.brands (symbol, slug, name_ar, name_en, published, company_id, source_submission_id)
VALUES ('LEGX', 'legx', 'منتج قديم', 'Legacy X', true, '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a001');
INSERT INTO public.company_invitations (company_id, email, role, invited_by, status, expires_at) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'pending-member@example.test', 'finance', (SELECT id FROM u WHERE k = 'owner'), 'pending', now() + interval '5 days'),
  ('00000000-0000-4000-8000-0000000c0001', 'stale-member@example.test', 'viewer', (SELECT id FROM u WHERE k = 'owner'), 'pending', now() - interval '2 days');
INSERT INTO public.access_requests (email, full_name, join_method, new_company_name_ar, new_company_name_en, status) VALUES
  ('new-company@example.test', 'New Applicant', 'new_company', 'شركة ناشئة', 'Startup Co', 'pending');
INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id, status) VALUES
  ('join@example.test', 'Joiner', 'search', '00000000-0000-4000-8000-0000000c0001', 'pending');
INSERT INTO public.price_alerts (user_id, symbol, direction, target_price)
SELECT id, (SELECT symbol FROM s WHERE n = 2), 'above', 150 FROM u WHERE k = 'inv1';
SQL
cnt() { su "SELECT (SELECT count(*) FROM auth.users) || '|' || (SELECT count(*) FROM public.companies) || '|' || (SELECT count(*) FROM public.company_members) || '|' || (SELECT count(*) FROM public.company_invitations) || '|' || (SELECT count(*) FROM public.access_requests) || '|' || (SELECT count(*) FROM public.product_submissions) || '|' || (SELECT count(*) FROM public.shariah_decisions) || '|' || (SELECT count(*) FROM public.trades) || '|' || (SELECT count(*) FROM public.orders) || '|' || (SELECT count(*) FROM public.price_alerts);"; }
KEPT_BEFORE=$(cnt)
CASH_BEFORE=$(su "SELECT sum(cash_balance) FROM public.portfolios;")
check "legacy state: 276 published seeds + the legacy approval, no ledger, several rulings" \
  "$(su "SELECT (SELECT count(*) FROM public.brands WHERE published) || '|' || (SELECT count(*) FROM public.cash_ledger) || '|' || (SELECT count(*) FROM public.shariah_decisions) || '|' || (SELECT count(*) FROM public.orders WHERE status IN ('open','pending','partial'));")" \
  "277|0|4|3"

echo "== 2. apply the bundle (as the owner would, one transaction)"
if OUT=$("${P[@]}" -d vt_prod -f "$BUNDLE" 2>&1); then RC=0; else RC=$?; fi
check "bundle applies with ON_ERROR_STOP" "$RC" "0"
[ "$RC" -ne 0 ] && echo "$OUT" | grep -E "ERROR|LINE|CONTEXT" | head -8 | sed 's/^/       | /'
check "bundle reports completion" "$(grep -c 'LAUNCH_BUNDLE_DONE' <<<"$OUT")" "1"
NMIG=$(cd "$REPO/supabase/migrations" && ls -1 -- *.sql | LC_ALL=C sort | awk -v f="$FIRST" '$0 >= f' | wc -l)
check "migration history lists every bundled version" \
  "$(su "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version >= '$FIRST';")|$(su "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version < '$FIRST';")" "$NMIG|1"

echo "== 3. schema equals a database built migration by migration"
newdb vt_ref || die "createdb vt_ref failed"
apply_range vt_ref "" "" || die "reference migrations failed"
dump() { "$PGBIN/pg_dump" -s -d "$1" --no-owner -N supabase_migrations -N go_live_archive 2>/dev/null | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'; }
dump vt_prod >"$WORK/prod.sql"; dump vt_ref >"$WORK/ref.sql"
DIFF=$(diff "$WORK/ref.sql" "$WORK/prod.sql" | head -40)
check "pg_dump --schema-only identical (functions, policies, grants, triggers, indexes)" "$DIFF" ""
check "schema dump is not trivially empty" "$([ "$(wc -l <"$WORK/prod.sql")" -gt 2000 ] && echo yes)" "yes"

echo "== 4. data after the bundle"
check "users, companies, members, invitations, requests, submissions, rulings, trades, orders, alerts kept" "$(cnt)" "$KEPT_BEFORE"
check "cash totals unchanged; every balance equals its ledger" \
  "$(su "SELECT sum(cash_balance) FROM public.portfolios;")|$(su "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);")" \
  "$CASH_BEFORE|0"
check "no resting order on an unpublished instrument; no fractional resting order" \
  "$(su "SELECT count(*) FROM public.orders o WHERE o.status IN ('open','partial','pending') AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published);")|$(su "SELECT count(*) FROM public.orders WHERE status IN ('open','partial','pending') AND qty <> trunc(qty);")" "0|0"
check "nothing listed without an admin-set price and a ruling (seeds and the legacy approval unlisted)" \
  "$(su "SELECT count(*) FROM public.brands WHERE published;")|$(su "SELECT published || '|' || trim_scale(reference_price) FROM public.brands WHERE symbol='LEGX';")" "0|false|0"
check "no ruling invented for the legacy approval; legacy rulings kept, latest in force" \
  "$(su "SELECT count(*) FROM public.shariah_decisions WHERE symbol='LEGX';")|$(su "SELECT string_agg(coalesce(public.current_shariah_status(symbol), '-'), ',' ORDER BY symbol) FROM (SELECT symbol FROM public.brands WHERE symbol IN (SELECT DISTINCT symbol FROM public.shariah_decisions) ORDER BY symbol) x;")" \
  "0|non_halal,halal"
check "submissions: the legacy approval awaits listing, the pending one awaits review" \
  "$(su "SELECT string_agg(symbol || ':' || status, ',' ORDER BY symbol) FROM public.product_submissions;")" "LEGX:approved,LEGY:pending"
check "pending invitations and access requests still reviewable" \
  "$(su "SELECT count(*) FROM public.access_requests WHERE status='pending';")|$(su "SELECT count(*) FROM public.company_invitations WHERE email='pending-member@example.test' AND status='pending';")" "2|1"
INTEG=$(svc "SELECT string_agg(check_key || '=' || ok, ',' ORDER BY check_key) FROM public.integrity_report();" | tail -1)
echo "  integrity report: $INTEG"
check "integrity report runs; cash, order and listing checks pass on migrated legacy data" \
  "$(tr ',' '\n' <<<"$INTEG" | grep -E '^(cash_matches_ledger|no_negative_cash|orders_fill_within_qty|no_resting_on_unpublished|published_ready|trade_cash_balanced|no_negative_positions|cost_basis_not_negative)=' | tr '\n' ',')" \
  "cash_matches_ledger=true,cost_basis_not_negative=true,no_negative_cash=true,no_negative_positions=true,no_resting_on_unpublished=true,orders_fill_within_qty=true,published_ready=true,trade_cash_balanced=true,"

check "the integrity report flags legacy units with no issuance behind them (cleared by go_live_reset.sql)" \
  "$(tr ',' '\n' <<<"$INTEG" | grep -E '^units_' | tr '\n' ',')" "units_conserved_per_symbol=false,units_match_history=false,"
check "a legacy balance no history explains is held for review, trading off" \
  "$(su "SELECT string_agg(h.reason, ',' ORDER BY h.reason) FROM public.launch_review_holds h JOIN auth.users u ON u.id = h.user_id WHERE u.email='legacy-inv2@example.test';")|$(su "SELECT count(*) FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE u.email='legacy-inv2@example.test' AND r.role='trader';")" \
  "unexplained_cash,unexplained_units|0"

echo "== 5. the lifecycle and the engine on the migrated database"
ADMIN=$(su "SELECT id FROM auth.users WHERE email='legacy-admin@example.test';")
BOARD=$(su "SELECT id FROM auth.users WHERE email='legacy-board@example.test';")
INV1=$(su "SELECT id FROM auth.users WHERE email='legacy-inv1@example.test';")
INV2=$(su "SELECT id FROM auth.users WHERE email='legacy-inv2@example.test';")
INV3=$(su "SELECT id FROM auth.users WHERE email='legacy-inv3@example.test';")
check "a reviewer rules on the legacy approval's unlisted instrument" \
  "$(as_user "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('LEGX','halal','Reviewed at launch') RETURNING status;" | tail -1)" "halal"
check "the admin lists it with a real price and a first allocation" \
  "$(svc "SELECT symbol || '|' || published || '|' || (issuance_id IS NOT NULL) FROM public.approve_listing('00000000-0000-4000-8000-00000000a001', '$ADMIN', 25, '$INV3', 100);" | tail -1)" "LEGX|true|true"
check "the pending submission is reviewed through the lifecycle" \
  "$(svc "SELECT status || '|' || ruling_recorded FROM public.review_submission('00000000-0000-4000-8000-00000000a002', '$BOARD', 'approved', 'Compliant');" | tail -1)" "approved|true"
svc "SELECT public.post_cash_movement('$INV1', 'deposit', 1000, NULL, 'launch funding', '$ADMIN');" >/dev/null
check "a sell rests and a buy fills against it" \
  "$(svc "SELECT status FROM public.match_order('$INV3'::uuid, 'LEGX', 'brand', 'sell', 'limit', 10, 25);" | tail -1)|$(svc "SELECT status FROM public.match_order('$INV1'::uuid, 'LEGX', 'brand', 'buy', 'limit', 10, 25);" | tail -1)" "open|filled"
check "cash still equals the ledger for every portfolio after trading" \
  "$(su "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);")|$(su "SELECT coalesce(trim_scale(sum(amount)), 0) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell');")" "0|0"

echo "== 6. a second run is refused and changes nothing"
SNAP=$(su "SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (SELECT id::text || cash_balance AS t FROM public.portfolios UNION ALL SELECT id::text || status FROM public.orders UNION ALL SELECT id::text FROM public.audit_log UNION ALL SELECT version FROM supabase_migrations.schema_migrations) x;")
if OUT=$("${P[@]}" -d vt_prod -f "$BUNDLE" 2>&1); then RC=0; else RC=$?; fi
check "second run stops with LAUNCH_BUNDLE_ALREADY_APPLIED" "$([ "$RC" -ne 0 ] && grep -q LAUNCH_BUNDLE_ALREADY_APPLIED <<<"$OUT" && echo refused || echo "rc=$RC")" "refused"
check "second run changed nothing" "$(su "SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (SELECT id::text || cash_balance AS t FROM public.portfolios UNION ALL SELECT id::text || status FROM public.orders UNION ALL SELECT id::text FROM public.audit_log UNION ALL SELECT version FROM supabase_migrations.schema_migrations) x;")" "$SNAP"
"${P[@]}" -d postgres -c "CREATE DATABASE vt_wrong" >/dev/null
if OUT=$("${P[@]}" -d vt_wrong -f "$BUNDLE" 2>&1); then RC=0; else RC=$?; fi
check "refused on a database that is not Value Unit's" "$([ "$RC" -ne 0 ] && grep -q LAUNCH_BUNDLE_WRONG_DATABASE <<<"$OUT" && echo refused || echo "rc=$RC")" "refused"

echo "== 7. go_live_reset.sql on the migrated database"
if OUT=$("${P[@]}" -d vt_prod -f "$HERE/go_live_reset.sql" 2>&1); then RC=0; else RC=$?; fi
check "the go-live reset runs after the bundle" "$RC|$(grep -c GO_LIVE_RESET_DONE <<<"$OUT")" "0|1"
check "every integrity check passes after the reset" \
  "$(svc "SELECT count(*) FILTER (WHERE NOT ok) || '|' || count(*) FROM public.integrity_report();" | tail -1)" "0|11"
check "the committed bundle is up to date" "$(bash "$HERE/build_launch_bundle.sh" --check >/dev/null 2>&1 && echo current || echo stale)" "current"

echo
echo "passed: $PASS  failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then printf '  FAILED: %s\n' "${FAILED[@]}"; exit 1; fi
echo "LAUNCH BUNDLE CHECKS PASSED"
