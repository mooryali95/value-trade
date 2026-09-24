#!/usr/bin/env bash
# Regression test for supabase/ops/go_live_reset.sql.
#
# Needs a database built from every migration (it writes fixtures, so use a
# throwaway one), reached through the standard libpq env (PGHOST, PGPORT,
# PGUSER) as a superuser / migration owner:
#
#   KEEP_DB=1 bash supabase/tests/run.sh          # prints PGHOST/PGPORT
#   PGHOST=... PGPORT=5432 PGUSER=postgres DB=vt_security \
#     bash supabase/ops/test_go_live_reset.sh
#
# Scenario: an admin funds three investors, issues units, they trade (full
# and partial fills) and leave resting orders and a price alert. Then:
#   1. the reset archives every table with the exact row counts, clears the
#      trading state and keeps every invariant of supabase/tests/security.sh;
#   2. a second run fails with GO_LIVE_RESET_ALREADY_RUN and changes nothing;
#   3. the engine works normally after the reset;
#   4. the restore procedure in the script header brings the archived state
#      back exactly.
set -uo pipefail
: "${DB:?DB is required}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/go_live_reset.sql"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
PASS=0; FAIL=0
su() { "${PSQL[@]}" -c "$1" 2>&1; }
svc() { printf 'BEGIN;\nSET LOCAL ROLE service_role;\n%s\nCOMMIT;\n' "$1" | "${PSQL[@]}" 2>&1; }
check() { if [ "$2" == "$3" ]; then PASS=$((PASS + 1)); echo "  PASS $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1: expected [$3] got [$2]"; fi; }
newuser() { su "INSERT INTO auth.users (email) VALUES ('$1') RETURNING id;" | head -1; }
mo() { svc "SELECT status FROM public.match_order('$1'::uuid, '$2', 'brand', '$3', 'limit', $4, $5);" | tail -1; }

TABLES="portfolios positions orders orders_audit trades cash_ledger unit_issuances price_alerts"
counts() { local out=""; for t in $TABLES; do out+="$t=$(su "SELECT count(*) FROM public.$t;") "; done; echo "$out"; }
invariants() {
  su "SELECT
    (SELECT count(*) FROM public.portfolios p WHERE p.cash_balance < 0 OR p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id))
    || '|' || coalesce((SELECT trim_scale(sum(amount)) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell')), 0)
    || '|' || (WITH moves AS (
          SELECT user_id, symbol, qty FROM public.unit_issuances
          UNION ALL SELECT buyer_id, symbol, qty FROM public.trades
          UNION ALL SELECT seller_id, symbol, -qty FROM public.trades
        ), expected AS (SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2)
        SELECT count(*) FROM expected e FULL JOIN public.positions p USING (user_id, symbol)
         WHERE coalesce(e.qty, 0) <> coalesce(p.qty, 0) OR coalesce(p.qty, 0) < 0)
    || '|' || (SELECT count(*) FROM public.orders WHERE filled_qty > qty);"
}
snapshot() {
  su "SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (
        SELECT 'p' || user_id || cash_balance AS x FROM public.portfolios
        UNION ALL SELECT 'q' || user_id || symbol || qty FROM public.positions
        UNION ALL SELECT 'o' || id || status || filled_qty FROM public.orders
        UNION ALL SELECT 't' || id FROM public.trades
        UNION ALL SELECT 'l' || id || amount FROM public.cash_ledger
        UNION ALL SELECT 'a' || id FROM public.orders_audit
        UNION ALL SELECT 'i' || id FROM public.unit_issuances) s;"
}

echo "== fixtures"
ADMIN=$(newuser golive-admin@test.local); A=$(newuser golive-a@test.local)
B=$(newuser golive-b@test.local); C=$(newuser golive-c@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$ADMIN','platform_admin'), ('$A','trader'), ('$B','trader'), ('$C','trader');" >/dev/null
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES
      ('GLVA','glva','أ','Go-live A',100,true), ('GLVB','glvb','ب','Go-live B',20,true);" >/dev/null
for u in $A $B $C; do svc "SELECT public.post_cash_movement('$u', 'deposit', 50000, NULL, 'seed', '$ADMIN');" >/dev/null; done
svc "SELECT public.issue_units('$ADMIN', '$B', 'GLVA', 500, 100, 'fixture'), public.issue_units('$ADMIN', '$C', 'GLVB', 300, 20, 'fixture');" >/dev/null
check "sell rests" "$(mo "$B" GLVA sell 100 101)" "open"
check "buy fills fully" "$(mo "$A" GLVA buy 40 101)" "filled"
check "second buy fills the rest" "$(mo "$C" GLVA buy 60 102)" "filled"
check "partial fill leaves a resting remainder" "$(mo "$A" GLVB buy 50 21)" "open"
check "sell crosses the resting bid" "$(mo "$C" GLVB sell 20 21)" "filled"
check "open ask remains" "$(mo "$B" GLVA sell 10 110)" "open"
CXL=$(svc "SELECT order_id FROM public.match_order('$C'::uuid, 'GLVB', 'brand', 'sell', 'limit', 5, 24);" | tail -1)
check "a resting order is cancelled (orders_audit row)" "$(svc "SELECT status FROM public.cancel_order('$C'::uuid, '$CXL'::uuid);" | tail -1)" "cancelled"
su "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) VALUES ('$A','GLVA','above',120);" >/dev/null
check "invariants hold before the reset" "$(invariants)" "0|0|0|0"
BEFORE=$(counts); SNAP=$(snapshot)
OPEN_BEFORE=$(su "SELECT count(*) FROM public.orders WHERE status IN ('open','partial');")
echo "  rows before: $BEFORE (open orders: $OPEN_BEFORE)"
check "scenario produced trades, ledger rows, audit rows and resting orders" \
  "$(su "SELECT (SELECT count(*) FROM public.trades) >= 3 AND (SELECT count(*) FROM public.cash_ledger) > 3 AND (SELECT count(*) FROM public.orders_audit) > 0 AND $OPEN_BEFORE >= 2;")" "t"

echo "== first run"
OUT=$("${PSQL[@]}" -f "$SCRIPT" 2>&1); RC=$?
check "reset succeeds" "$RC" "0"
grep -q GO_LIVE_RESET_DONE <<<"$OUT" && check "reset reports completion" "t" "t" || check "reset reports completion" "$OUT" "GO_LIVE_RESET_DONE"
ARCH=""; for t in $TABLES; do ARCH+="$t=$(su "SELECT count(*) FROM go_live_archive.archive_20260925_$t;") "; done
check "archives hold exactly the pre-reset rows" "$ARCH" "$BEFORE"
check "trading tables cleared, portfolios and alerts kept" "$(counts)" \
  "portfolios=$(su "SELECT count(*) FROM public.portfolios;") positions=0 orders=0 orders_audit=0 trades=0 cash_ledger=0 unit_issuances=0 price_alerts=1 "
check "every cash balance is 0" "$(su "SELECT count(*) FROM public.portfolios WHERE cash_balance <> 0;")" "0"
check "invariants hold after the reset" "$(invariants)" "0|0|0|0"
check "users, roles and brands kept" "$(su "SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'golive-%') || '|' || (SELECT count(*) FROM public.user_roles WHERE user_id IN ('$ADMIN','$A','$B','$C')) || '|' || (SELECT count(*) FROM public.brands WHERE symbol LIKE 'GLV_');")" "4|4|2"
check "audit_log entry written" "$(su "SELECT count(*) || '|' || max(actor_id::text) || '|' || max(metadata->>'open_orders_cancelled') || '|' || max(metadata->'archived_rows'->>'trades') FROM public.audit_log WHERE action='go_live_reset';")" \
  "1|$(su "SELECT user_id FROM public.user_roles WHERE role='platform_admin' ORDER BY created_at, user_id LIMIT 1;")|$OPEN_BEFORE|$(sed -E 's/.*trades=([0-9]+).*/\1/' <<<"$BEFORE")"
check "archive is private (no grants to API roles)" \
  "$(su "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='go_live_archive' AND grantee IN ('anon','authenticated','service_role','PUBLIC');")|$(su "SELECT has_schema_privilege('anon','go_live_archive','USAGE') OR has_schema_privilege('authenticated','go_live_archive','USAGE') OR has_schema_privilege('service_role','go_live_archive','USAGE');")" "0|f"

echo "== second run"
AFTER1=$(counts); AUDIT1=$(su "SELECT count(*) FROM public.audit_log;")
OUT=$("${PSQL[@]}" -f "$SCRIPT" 2>&1); RC=$?
check "second run is refused" "$([ "$RC" -ne 0 ] && grep -q GO_LIVE_RESET_ALREADY_RUN <<<"$OUT" && echo refused || echo "rc=$RC $OUT")" "refused"
check "second run changed nothing" "$(counts)|$(su "SELECT count(*) FROM public.audit_log;")" "$AFTER1|$AUDIT1"
check "archive untouched by the second run" "$(for t in $TABLES; do printf '%s=%s ' "$t" "$(su "SELECT count(*) FROM go_live_archive.archive_20260925_$t;")"; done)" "$BEFORE"

echo "== engine after the reset"
svc "SELECT public.post_cash_movement('$A', 'deposit', 1000, NULL, 'launch funding', '$ADMIN');" >/dev/null
svc "SELECT public.issue_units('$ADMIN', '$B', 'GLVA', 10, 100, 'launch issue');" >/dev/null
check "fresh sell rests" "$(mo "$B" GLVA sell 5 100)" "open"
check "fresh buy fills at the reference band" "$(mo "$A" GLVA buy 5 100)" "filled"
check "invariants hold after new trading" "$(invariants)" "0|0|0|0"

echo "== restore procedure from the header"
RESTORE=$(sed -n '/^--   BEGIN;$/,/^--   COMMIT;$/p' "$SCRIPT" | sed -E 's/^--   ?//')
OUT=$(printf '%s\n' "$RESTORE" | "${PSQL[@]}" 2>&1); RC=$?
check "restore applies" "$RC" "0"
check "restore brings back the archived state exactly" "$(snapshot)" "$SNAP"
check "invariants hold after the restore" "$(invariants)" "0|0|0|0"

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ] && echo "GO-LIVE RESET CHECKS PASSED" || exit 1
