#!/usr/bin/env bash
# Database security regression suite (run it through supabase/tests/run.sh,
# which builds a fresh database from supabase/migrations first).
#
# Every check runs as a real API caller in its own transaction, the way
# PostgREST does it: SET LOCAL ROLE anon | authenticated | service_role and
# request.jwt.claims (sub/role/email), so RLS, column grants, EXECUTE grants
# and auth.uid() behave as in production. Fixtures are written as the
# migration owner (superuser). Prints PASS/FAIL per check and exits non-zero
# if any check fails.
#
# Env (set by run.sh): DB, REPO, WORK (scratch dir), PSQL_BIN, PGHOST/PGPORT/PGUSER.
set -uo pipefail
: "${DB:?DB is required}"
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WORK="${WORK:-$(mktemp -d)}"
PSQL=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
PASS=0; FAIL=0; FAILED=()

# ---------------------------------------------------------------- helpers ---
su() { "${PSQL[@]}" -c "$1" 2>&1; }            # superuser / migration owner
q() {                                           # q <anon|service|uuid> <sql>
  local who=$1 sql=$2 pre
  case "$who" in
    anon) pre="SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims','{\"role\":\"anon\"}',true);";;
    service) pre="SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);";;
    *) pre="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"$who\",\"role\":\"authenticated\",\"email\":\"$who@test.local\"}',true);";;
  esac
  printf 'BEGIN;\n\\o /dev/null\n%s\n\\o\n%s\nCOMMIT;\n' "$pre" "$sql" | "${PSQL[@]}" 2>&1
}
ok() { PASS=$((PASS + 1)); echo "  PASS $1"; }
bad() { FAIL=$((FAIL + 1)); FAILED+=("$1"); echo "  FAIL $1"; printf '%s\n' "$2" | head -8 | sed 's/^/       | /'; }
section() { echo; echo "== $1"; }
# expect_eq <name> <who> <expected output> <sql>
expect_eq() { local out; out=$(q "$2" "$4"); if [ "$out" == "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$out]"; fi; }
# expect_err <name> <who> <error regex> <sql>
expect_err() { local out; out=$(q "$2" "$4"); if grep -qE "ERROR: +.*($3)" <<<"$out"; then ok "$1"; else bad "$1" "expected error /$3/ got: $out"; fi; }
# expect_ok <name> <who> <sql>
expect_ok() { local out; out=$(q "$2" "$3"); if grep -q "ERROR" <<<"$out"; then bad "$1" "$out"; else ok "$1"; fi; }
# su_eq <name> <expected> <sql>
su_eq() { local out; out=$(su "$3"); if [ "$out" == "$2" ]; then ok "$1"; else bad "$1" "expected [$2] got [$out]"; fi; }
check() { if [ "$2" == "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
newuser() { su "INSERT INTO auth.users (email) VALUES ('$1') RETURNING id;" | head -1; }
# mo <user> <symbol> <side> <type> <qty> <price|NULL>: match_order as the server
# calls it (service_role) -> "order_id|filled_qty|avg_price|status"
mo() {
  q service "SELECT order_id || '|' || trim_scale(filled_qty) || '|' || coalesce(avg_price::text,'') || '|' || status
             FROM public.match_order('$1'::uuid, '$2', 'brand', '$3', '$4', $5, $6);"
}
mo_id() { mo "$@" | cut -d'|' -f1; }
cash() { su "SELECT coalesce((SELECT cash_balance FROM public.portfolios WHERE user_id='$1'), 0);"; }
total_cash() { su "SELECT coalesce(sum(cash_balance), 0) FROM public.portfolios;"; }
total_units() { su "SELECT coalesce(trim_scale(sum(qty)), 0) FROM public.positions WHERE symbol='$1';"; }

# ------------------------------------------------------------------ setup ---
section "setup"
ADMIN=$(newuser admin@test.local); ALICE=$(newuser alice@test.local); BOB=$(newuser bob@test.local)
CAROL=$(newuser carol@test.local); DAVE=$(newuser dave@test.local); BOARD=$(newuser board@test.local)
OWNER=$(newuser owner@test.local); OWNER2=$(newuser owner2@test.local); VIEWER=$(newuser viewer@test.local)
ERIN=$(newuser erin@test.local); FRANK=$(newuser frank@test.local); GUS=$(newuser gus@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES
  ('$ADMIN','platform_admin'), ('$ALICE','trader'), ('$BOB','trader'), ('$DAVE','trader'), ('$BOARD','shariah_board'),
  ('$ERIN','trader'), ('$FRANK','trader'), ('$GUS','trader');" >/dev/null
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES
  ('TSTA','tsta','a','Test A',100,true), ('TSTB','tstb','b','Test B',10,true),
  ('TSTU','tstu','u','Test U',100,false), ('TSTD','tstd','d','Test D',100,true),
  ('TSTP','tstp','p','Test P',100,true), ('TSTH','tsth','h','Test H',100,true);" >/dev/null
CO=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('acme','acme','Acme','$OWNER') RETURNING id;" | head -1)
CO2=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('other','o','Other','$OWNER2') RETURNING id;" | head -1)
su "INSERT INTO public.company_members (company_id, user_id, role) VALUES ('$CO','$VIEWER','viewer');" >/dev/null
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published, company_id) VALUES ('TSTC','tstc','c','Test C',50,true,'$CO');" >/dev/null
for u in $ALICE $BOB $DAVE $ERIN $FRANK $GUS; do q service "SELECT public.post_cash_movement('$u', 'deposit', 100000, NULL, 'seed', '$ADMIN');" >/dev/null; done
# Initial inventory, allocated through primary issuance (issue_units, the
# only way units enter the market besides trading). Position conservation is
# checked against unit_issuances + trades at the end.
su "CREATE SCHEMA tst;
    CREATE TABLE tst.fixture_positions (user_id uuid, symbol text, qty numeric);
    INSERT INTO tst.fixture_positions VALUES
      ('$BOB','TSTA',1000), ('$BOB','TSTD',1000), ('$ALICE','TSTB',10),
      ('$ERIN','TSTP',100), ('$FRANK','TSTP',100), ('$ERIN','TSTH',100);
    GRANT USAGE ON SCHEMA tst TO service_role; GRANT SELECT ON tst.fixture_positions TO service_role;" >/dev/null
q service "SELECT count(public.issue_units('$ADMIN', user_id, symbol, qty, 90, 'fixture')) FROM tst.fixture_positions;" >/dev/null
su_eq "fixture units issued" "6|2310" "SELECT count(*) || '|' || trim_scale(sum(qty)) FROM public.positions;"
su_eq "fixtures created" "12|7" "SELECT (SELECT count(*) FROM auth.users) || '|' || (SELECT count(*) FROM public.brands WHERE symbol LIKE 'TST_');"

# ------------------------------------------------ RLS helpers / baseline ---
section "RLS helper grants and baseline reads"
expect_eq "authenticated reads own user_roles" "$ALICE" "trader" "SELECT role FROM public.user_roles;"
expect_eq "authenticated reads own companies" "$OWNER" "acme" "SELECT slug FROM public.companies;"
expect_eq "member reads company brand" "$OWNER" "1" "SELECT count(*) FROM public.brands WHERE symbol='TSTC';"
expect_eq "authenticated cannot see unpublished brands" "$ALICE" "0" "SELECT count(*) FROM public.brands WHERE symbol='TSTU';"
expect_eq "anon reads published brands" anon "1" "SELECT count(*) FROM public.brands WHERE symbol='TSTA';"
expect_ok "authenticated can rpc has_role" "$ALICE" "SELECT public.has_role(auth.uid(), 'trader');"
expect_err "anon cannot rpc has_role" anon "permission denied" "SELECT public.has_role(gen_random_uuid(), 'trader');"
expect_err "anon cannot read user_roles" anon "permission denied" "SELECT * FROM public.user_roles;"

# ------------------------------------ (a) users cannot write money tables ---
section "(a) financial and governance tables are read-only for API users"
expect_err "cannot set own cash_balance" "$ALICE" "permission denied" "UPDATE public.portfolios SET cash_balance = 1e9 WHERE user_id = auth.uid();"
expect_err "cannot insert portfolio" "$CAROL" "permission denied" "INSERT INTO public.portfolios (user_id, cash_balance) VALUES (auth.uid(), 1e9);"
expect_err "cannot delete portfolio" "$ALICE" "permission denied" "DELETE FROM public.portfolios WHERE user_id = auth.uid();"
expect_err "cannot mint positions" "$ALICE" "permission denied" "INSERT INTO public.positions (user_id, symbol, qty) VALUES (auth.uid(), 'TSTA', 100);"
expect_err "cannot edit positions" "$BOB" "permission denied" "UPDATE public.positions SET qty = 1e6 WHERE user_id = auth.uid();"
expect_err "cannot delete positions" "$BOB" "permission denied" "DELETE FROM public.positions WHERE user_id = auth.uid();"
expect_err "cannot insert fake resting order (backdated)" "$ALICE" "permission denied" "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, created_at) VALUES (auth.uid(),'TSTA','sell','limit',1,1,'open','2000-01-01');"
expect_err "cannot insert filled order" "$ALICE" "permission denied" "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_price) VALUES (auth.uid(),'TSTA','buy','limit',1,1,'filled',9999);"
expect_err "cannot mark own order filled" "$ALICE" "permission denied" "UPDATE public.orders SET status='filled', filled_qty=qty, filled_price=1 WHERE user_id = auth.uid();"
expect_err "cannot backdate own order (time priority)" "$ALICE" "permission denied" "UPDATE public.orders SET created_at='2000-01-01' WHERE user_id = auth.uid();"
expect_err "cannot delete own orders" "$ALICE" "permission denied" "DELETE FROM public.orders WHERE user_id = auth.uid();"
expect_err "cannot write orders_audit" "$ALICE" "permission denied" "INSERT INTO public.orders_audit (order_id, action, changed_by) VALUES (gen_random_uuid(),'x',auth.uid());"
expect_err "cannot rewrite orders_audit" "$ALICE" "permission denied" "UPDATE public.orders_audit SET action='x';"
expect_err "cannot delete orders_audit" "$ALICE" "permission denied" "DELETE FROM public.orders_audit;"
expect_err "cannot write cash_ledger" "$ALICE" "permission denied" "INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after) VALUES (auth.uid(),'deposit',1,1);"
expect_err "cannot edit cash_ledger" "$ALICE" "permission denied" "UPDATE public.cash_ledger SET amount = 1e9 WHERE user_id = auth.uid();"
expect_err "cannot delete cash_ledger" "$ALICE" "permission denied" "DELETE FROM public.cash_ledger WHERE user_id = auth.uid();"
expect_err "cannot write trades" "$ALICE" "permission denied" "INSERT INTO public.trades (symbol, qty, price, buyer_id, seller_id) VALUES ('TSTA',1,1,auth.uid(),auth.uid());"
expect_err "cannot edit trades" "$ALICE" "permission denied" "UPDATE public.trades SET price = 1;"
expect_err "cannot delete trades" "$ALICE" "permission denied" "DELETE FROM public.trades;"
expect_err "cannot truncate orders" "$ALICE" "permission denied" "TRUNCATE public.orders;"
expect_err "cannot write own audit_log row" "$ALICE" "permission denied" "INSERT INTO public.audit_log (actor_id, action, entity) VALUES (auth.uid(),'x','y');"
expect_err "cannot write audit_log for another company" "$OWNER" "permission denied" "INSERT INTO public.audit_log (actor_id, company_id, action, entity) VALUES (auth.uid(),'$CO2','x','y');"
expect_err "cannot edit audit_log" "$ADMIN" "permission denied" "UPDATE public.audit_log SET action='x';"
expect_err "trader cannot grant self platform_admin" "$ALICE" "permission denied" "INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(),'platform_admin');"
expect_err "new user cannot grant self trader" "$CAROL" "permission denied" "INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(),'trader');"
expect_err "trader cannot upgrade own role row" "$ALICE" "permission denied" "UPDATE public.user_roles SET role='platform_admin' WHERE user_id = auth.uid() RETURNING role;"
expect_err "trader cannot delete role rows" "$ALICE" "permission denied" "DELETE FROM public.user_roles WHERE user_id = auth.uid();"
su_eq "role unchanged after update attempt" "trader" "SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id='$ALICE';"
expect_err "platform admin cannot write roles through the API either" "$ADMIN" "permission denied" "INSERT INTO public.user_roles (user_id, role) VALUES ('$CAROL','trader');"
expect_eq "platform admin reads every role row" "$ADMIN" "t" "SELECT count(DISTINCT user_id) > 1 FROM public.user_roles;"
expect_eq "server (service role) manages roles" service "trader" "INSERT INTO public.user_roles (user_id, role) VALUES ('$CAROL','trader') RETURNING role; DELETE FROM public.user_roles WHERE user_id='$CAROL' AND role='trader';"
su_eq "role grant/revoke round-trip" "0" "SELECT count(*) FROM public.user_roles WHERE user_id='$CAROL';"
su_eq "no write policy and no write grant on user_roles" "0|0" "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND cmd <> 'SELECT') || '|' || (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='user_roles' AND grantee IN ('anon','authenticated','PUBLIC') AND privilege_type <> 'SELECT');"
# Drift: a self-insert policy added outside the migrations is removed.
su "CREATE POLICY \"Users can insert their own roles\" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
    GRANT INSERT ON public.user_roles TO authenticated;" >/dev/null
GOVMIG=$(ls "$REPO"/supabase/migrations/*_governance_and_listing_fixes.sql 2>/dev/null | head -1)
if [ -n "$GOVMIG" ] && out=$("${PSQL[@]}" -1 -f "$GOVMIG" 2>&1 >/dev/null); then ok "governance fixes migration re-applies on a drifted database"
else bad "governance fixes migration re-applies on a drifted database" "${GOVMIG:-*_governance_and_listing_fixes.sql not found} ${out:-}"; fi
expect_err "drifted self-insert policy no longer lets a user grant themselves a role" "$CAROL" "permission denied" "INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(),'platform_admin');"
expect_eq "viewer cannot promote self to owner" "$VIEWER" "" "UPDATE public.company_members SET role='owner' WHERE company_id='$CO' AND user_id=auth.uid() RETURNING role;"
su_eq "viewer role unchanged" "viewer" "SELECT role FROM public.company_members WHERE company_id='$CO' AND user_id='$VIEWER';"
expect_eq "owner of another company cannot change roles here" "$OWNER2" "" "UPDATE public.company_members SET role='owner' WHERE company_id='$CO' RETURNING role;"
expect_err "cannot add self to another company" "$OWNER2" "row-level security" "INSERT INTO public.company_members (company_id, user_id, role) VALUES ('$CO', auth.uid(), 'owner');"
expect_err "cannot move a membership to another company" "$OWNER" "permission denied" "UPDATE public.company_members SET company_id='$CO2' WHERE company_id='$CO' AND user_id='$VIEWER';"
expect_err "non-admin cannot create companies" "$ALICE" "row-level security" "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('mine','m','Mine',auth.uid());"
expect_err "owner cannot change company slug" "$OWNER" "permission denied" "UPDATE public.companies SET slug='hijack' WHERE id='$CO';"
expect_err "anon cannot read portfolios" anon "permission denied" "SELECT * FROM public.portfolios;"
expect_err "anon cannot read positions" anon "permission denied" "SELECT * FROM public.positions;"
expect_err "anon cannot read orders" anon "permission denied" "SELECT * FROM public.orders;"
expect_err "anon cannot read trades" anon "permission denied" "SELECT * FROM public.trades;"
expect_err "anon cannot read cash_ledger" anon "permission denied" "SELECT * FROM public.cash_ledger;"
expect_err "anon cannot write anything to orders" anon "permission denied" "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status) VALUES (gen_random_uuid(),'TSTA','sell','limit',1,1,'open');"
expect_ok "own price alert allowed" "$ALICE" "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) VALUES (auth.uid(),'TSTA','above',120);"
expect_err "price alert for someone else denied" "$ALICE" "row-level security" "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) VALUES ('$BOB','TSTA','above',120);"
expect_ok "own watcher upsert allowed" "$ALICE" "INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (auth.uid(),'TSTA') ON CONFLICT (user_id, symbol) DO UPDATE SET asset_class = EXCLUDED.asset_class;"
expect_ok "own notification prefs upsert allowed" "$ALICE" "INSERT INTO public.notification_preferences (user_id, price_alerts_email) VALUES (auth.uid(), false) ON CONFLICT (user_id) DO UPDATE SET price_alerts_email = EXCLUDED.price_alerts_email;"
expect_ok "own profile update allowed" "$ALICE" "UPDATE public.profiles SET full_name = 'Alice' WHERE id = auth.uid();"
su_eq "no anon write grant on any public table" "0" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','PUBLIC') AND privilege_type <> 'SELECT';"
su_eq "no authenticated write grant on financial/governance tables" "0" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='authenticated' AND privilege_type <> 'SELECT' AND table_name IN ('portfolios','positions','orders','orders_audit','cash_ledger','trades','audit_log','access_requests','shariah_decision_audit','rate_limits','email_send_log','email_send_state','suppressed_emails','email_unsubscribe_tokens','ops_run_log','ops_settings');"
su_eq "no column-level write grant on financial tables" "0" "SELECT count(*) FROM information_schema.column_privileges WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type <> 'SELECT' AND table_name IN ('portfolios','positions','orders','orders_audit','cash_ledger','trades','audit_log');"
su_eq "no write policy on financial tables" "0" "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('portfolios','positions','orders','orders_audit','cash_ledger','trades') AND cmd <> 'SELECT';"
su_eq "RLS enabled on every public table" "" "SELECT string_agg(relname, ',') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;"
su_eq "no authenticated TRUNCATE/TRIGGER/REFERENCES anywhere" "0" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES');"

# ------------------------------- (b) privileged functions: service_role only ---
section "(b) privileged functions cannot be executed by anon or authenticated"
SERVICE_ONLY=(
  "check_rate_limit(text, integer, integer)"
  "enqueue_email(text, jsonb)"
  "read_email_batch(text, integer, integer)"
  "delete_email(text, bigint)"
  "move_to_dlq(text, text, bigint, jsonb)"
  "search_companies_public(text)"
  "get_company_by_slug_public(text)"
  "check_access_request_status(uuid, text)"
  "accept_company_invitation(uuid, uuid, text)"
  "approve_access_request(uuid, uuid, public.company_role, text, text)"
  "reject_access_request(uuid, uuid, text)"
  "post_cash_movement(uuid, text, numeric, uuid, text, uuid)"
  "apply_trade_position(uuid, text, text, text, numeric, numeric)"
  "match_order(uuid, text, text, text, text, numeric, numeric)"
  "cancel_order(uuid, uuid)"
  "replace_order(uuid, uuid, numeric, numeric)"
  "restore_order(uuid, uuid)"
  "engine_cancel_order(uuid, text, uuid)"
  "cancel_shariah_blocked_buys(text, uuid)"
  "current_shariah_status(text)"
  "list_my_trades(uuid, text, integer)"
  "band_reference_price(text)"
  "deactivate_trader(uuid, uuid)"
  "issue_units(uuid, uuid, text, numeric, numeric, text)"
  "market_instrument_rows(uuid, uuid)"
  "close_instrument_orders(text, text, uuid)"
  "set_instrument_published(text, boolean, uuid)"
)
for sig in "${SERVICE_ONLY[@]}"; do
  name=${sig%%(*}
  args=${sig#*(}; args=${args%)}
  call="SELECT public.$name($(sed -E 's/([^,]+)/NULL::\1/g; s/:: /::/g' <<<"$args"));"
  exists=$(su "SELECT to_regprocedure('public.$sig') IS NOT NULL;")
  if [ "$exists" != t ]; then bad "public.$sig exists" "function not found on a fresh rebuild"; continue; fi
  expect_err "anon cannot EXECUTE $name" anon "permission denied for function $name" "$call"
  expect_err "authenticated cannot EXECUTE $name" "$ADMIN" "permission denied for function $name" "$call"
  su_eq "service_role can EXECUTE $name" "t" "SELECT has_function_privilege('service_role', 'public.$sig', 'EXECUTE');"
done
expect_err "anon cannot insert access_requests directly" anon "permission denied" "INSERT INTO public.access_requests (email, full_name, join_method, new_company_name_ar, new_company_name_en) VALUES ('a@b.c','A','new_company','x','y');"
expect_err "authenticated cannot insert access_requests directly" "$ALICE" "permission denied" "INSERT INTO public.access_requests (email, full_name, join_method, new_company_name_ar, new_company_name_en) VALUES ('a@b.c','A','new_company','x','y');"
expect_err "anon cannot update access_requests" anon "permission denied" "UPDATE public.access_requests SET status='approved';"
su_eq "SECURITY DEFINER functions executable by anon = public market data only" "get_order_book,get_symbol_last_trade,public_candles,public_company_profile,public_instrument,public_market_overview,public_market_summary,public_recent_trades,public_shariah_rulings" "SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE');"
su_eq "SECURITY DEFINER functions executable by authenticated = RLS helpers + market data" "get_market_snapshot,get_order_book,get_symbol_last_trade,get_symbol_market_stats,has_company_role,has_role,is_company_member,is_company_owner,public_candles,public_company_profile,public_instrument,public_market_overview,public_market_summary,public_recent_trades,public_shariah_rulings" "SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE');"
su_eq "every SECURITY DEFINER function pins search_path" "0" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');"

# ------------------------------------------------- (d) engine validation ---
section "(d) match_order input validation and risk checks"
expect_err "fractional qty rejected" service "INVALID_QTY" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1.5,100);"
expect_err "zero qty rejected" service "INVALID_QTY" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',0,100);"
expect_err "negative qty rejected" service "INVALID_QTY" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',-5,100);"
expect_err "qty over 10,000,000 rejected" service "INVALID_QTY" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',10000001,100);"
expect_err "sub-tick price rejected" service "INVALID_PRICE" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1,100.123);"
expect_err "zero price rejected" service "INVALID_PRICE" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1,0);"
expect_err "limit without price rejected" service "INVALID_PRICE" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1,NULL);"
expect_err "unpublished instrument" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.match_order('$ALICE','TSTU','brand','buy','limit',1,100);"
expect_err "unknown instrument" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.match_order('$ALICE','NOPE','brand','buy','limit',1,100);"
expect_err "non-trader rejected in SQL" service "FORBIDDEN_TRADER_REQUIRED" "SELECT * FROM public.match_order('$CAROL','TSTA','brand','buy','limit',1,100);"
expect_err "limit above +20% band" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1,120.01);"
expect_err "limit below -20% band" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1,79.99);"
expect_err "order notional over 5,000,000" service "ORDER_TOO_LARGE" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',50001,100);"
expect_err "market notional measured at band top" service "ORDER_TOO_LARGE" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','market',41667,NULL);"
expect_err "buy beyond cash" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','buy','limit',1001,100);"
expect_err "no short selling (sell without holdings)" service "INSUFFICIENT_QTY" "SELECT * FROM public.match_order('$ALICE','TSTA','brand','sell','limit',1,100);"
expect_err "no short selling (sell more than held)" service "INSUFFICIENT_QTY" "SELECT * FROM public.match_order('$ALICE','TSTB','brand','sell','limit',11,10);"
su_eq "rejected orders left nothing behind" "0" "SELECT count(*) FROM public.orders WHERE user_id IN ('$ALICE','$CAROL');"

section "(d) matching, settlement, rounding, average price"
CASH0=$(total_cash)
S1=$(mo_id "$BOB" TSTA sell limit 100 101)
S2=$(mo_id "$BOB" TSTA sell limit 100 100.5)
expect_eq "asks rest on the book" anon "sell|100.5|100
sell|101|100" "SELECT side, trim_scale(price), trim_scale(qty) FROM public.get_order_book('TSTA', 10) ORDER BY price;"
expect_err "open sells count against holdings" service "INSUFFICIENT_QTY" "SELECT * FROM public.match_order('$BOB','TSTA','brand','sell','limit',801,100);"
R=$(mo "$ALICE" TSTA buy limit 150 101)
check "limit buy sweeps by price priority, avg fill 100.6667" "$(cut -d'|' -f2- <<<"$R")" "150|100.6667|filled"
su_eq "resting ask fully filled" "filled|100|100.5000" "SELECT status, trim_scale(filled_qty), filled_price FROM public.orders WHERE id='$S2';"
su_eq "resting ask partially filled" "partial|50|101.0000" "SELECT status, trim_scale(filled_qty), filled_price FROM public.orders WHERE id='$S1';"
su_eq "buyer debit = seller credit per fill" "0" "SELECT trim_scale(sum(amount)) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell');"
su_eq "cash moved exactly" "84900.00|115100.00" "SELECT (SELECT cash_balance FROM public.portfolios WHERE user_id='$ALICE') || '|' || (SELECT cash_balance FROM public.portfolios WHERE user_id='$BOB');"
su_eq "positions moved" "150|850" "SELECT (SELECT qty::int FROM public.positions WHERE user_id='$ALICE' AND symbol='TSTA') || '|' || (SELECT qty::int FROM public.positions WHERE user_id='$BOB' AND symbol='TSTA');"
check "total cash unchanged by trades" "$(total_cash)" "$CASH0"
su_eq "ledger reconciles with balances" "0" "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id) OR p.cash_balance <> (SELECT balance_after FROM public.cash_ledger l WHERE l.user_id = p.user_id ORDER BY created_at DESC, id DESC LIMIT 1);"
# Legacy resting rows that break K1 (off-tick price, fractional remaining
# units) are taken off the book when reached, never filled.
L1=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$BOB','TSTA','sell','limit',3,100.005,'open',0) RETURNING id;" | head -1)
L2=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$BOB','TSTA','sell','limit',2.5,100.01,'open',0) RETURNING id;" | head -1)
TR0=$(su "SELECT count(*) FROM public.trades;")
R=$(mo "$ALICE" TSTA buy limit 3 100.01)
check "buy crossing only invalid legacy asks rests unfilled" "$(cut -d'|' -f2,4 <<<"$R")" "0|open"
su_eq "off-tick and fractional legacy asks cancelled by the engine" "cancelled|engine_cancel_invalid_order|cancelled|engine_cancel_invalid_order" "SELECT (SELECT status FROM public.orders WHERE id='$L1') || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$L1') || '|' || (SELECT status FROM public.orders WHERE id='$L2') || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$L2');"
su_eq "no trade printed from invalid legacy rows" "$TR0" "SELECT count(*) FROM public.trades;"
q service "SELECT * FROM public.cancel_order('$ALICE', '$(cut -d'|' -f1 <<<"$R")');" >/dev/null
su_eq "cash conserved across all fills" "0" "SELECT trim_scale(sum(amount)) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell');"
expect_eq "trader sees own trades without counterparty id" service "2" "SELECT count(*) FROM public.list_my_trades('$ALICE', 'TSTA', 50) WHERE side='buy';"
expect_err "counterparty id column not readable" "$ALICE" "permission denied" "SELECT buyer_id FROM public.trades;"
expect_err "counterparty id not filterable either" "$ALICE" "permission denied" "SELECT count(*) FROM public.trades WHERE seller_id = '$BOB';"
expect_eq "own trades readable (safe columns)" "$ALICE" "2" "SELECT count(*) FROM public.trades WHERE symbol='TSTA';"

section "(d) price-time priority and partial fills"
CASH0=$(total_cash); UNITS0=$(total_units TSTP)
P1=$(mo_id "$ERIN" TSTP sell limit 10 100)
P2=$(mo_id "$FRANK" TSTP sell limit 10 100)
P3=$(mo_id "$FRANK" TSTP sell limit 10 99.5)
R=$(mo "$GUS" TSTP buy limit 15 100)
check "incoming buy fills 15: best price first, then earliest at the same price" "$(cut -d'|' -f2,4 <<<"$R")" "15|filled"
su_eq "better-priced later ask filled first" "filled|10" "SELECT status || '|' || trim_scale(filled_qty) FROM public.orders WHERE id='$P3';"
su_eq "earlier ask at 100 filled next (time priority)" "partial|5" "SELECT status || '|' || trim_scale(filled_qty) FROM public.orders WHERE id='$P1';"
su_eq "later ask at 100 untouched" "open|0" "SELECT status || '|' || trim_scale(filled_qty) FROM public.orders WHERE id='$P2';"
R=$(mo "$GUS" TSTP buy limit 30 100)
check "incoming order partially fills and rests (15 of 30)" "$(cut -d'|' -f2,4 <<<"$R")" "15|partial"
GBID=$(cut -d'|' -f1 <<<"$R")
expect_eq "remainder rests on the book as a bid" anon "buy|100|15" "SELECT side, trim_scale(price), trim_scale(qty) FROM public.get_order_book('TSTP', 10) WHERE side='buy';"
su_eq "all TSTP asks consumed in priority order" "filled|filled|filled" "SELECT (SELECT status FROM public.orders WHERE id='$P3') || '|' || (SELECT status FROM public.orders WHERE id='$P1') || '|' || (SELECT status FROM public.orders WHERE id='$P2');"
R=$(mo "$ERIN" TSTP sell limit 5 100)
check "resting partial bid fills further" "$(cut -d'|' -f2,4 <<<"$R")" "5|filled"
su_eq "resting bid is partial with running fill qty" "partial|20" "SELECT status || '|' || trim_scale(filled_qty) FROM public.orders WHERE id='$GBID';"
check "total cash unchanged by these trades" "$(total_cash)" "$CASH0"
check "total TSTP units unchanged by these trades" "$(total_units TSTP)" "$UNITS0"
su_eq "buyer paid exactly what sellers received" "0" "SELECT trim_scale(sum(amount)) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell');"
su_eq "Gus holds 35 TSTP" "35" "SELECT trim_scale(qty) FROM public.positions WHERE user_id='$GUS' AND symbol='TSTP';"
q service "SELECT * FROM public.cancel_order('$GUS', '$GBID');" >/dev/null

section "(d) market orders: price protection band, remainder cancelled (K3)"
# No TSTA trade before today -> band anchored on reference_price 100: [80, 120].
# Bob: 50 left @101, add 10 @120 and a stale ask @130.
S3=$(mo_id "$BOB" TSTA sell limit 10 120)
su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$BOB','TSTA','sell','limit',10,130,'open',0);" >/dev/null
R=$(mo "$ALICE" TSTA buy market 100 NULL)
check "market buy fills only asks <= ref*1.2, remainder cancelled" "$(cut -d'|' -f2,4 <<<"$R")" "60|cancelled"
MID=$(cut -d'|' -f1 <<<"$R")
su_eq "market order never rests" "0" "SELECT count(*) FROM public.orders WHERE type='market' AND status IN ('open','partial');"
su_eq "ask above the band not filled by the market order" "open" "SELECT status FROM public.orders WHERE user_id='$BOB' AND price=130;"
su_eq "market remainder audited" "market_unfilled" "SELECT action FROM public.orders_audit WHERE order_id='$MID';"
R=$(mo "$ALICE" TSTB sell market 5 NULL)
check "market sell with no bids ends cancelled, filledQty 0" "$(cut -d'|' -f2,4 <<<"$R")" "0|cancelled"
su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$DAVE','TSTB','buy','limit',5,7,'open',0);" >/dev/null
R=$(mo "$ALICE" TSTB sell market 5 NULL)
check "market sell ignores bids below ref*0.8" "$(cut -d'|' -f2,4 <<<"$R")" "0|cancelled"
R=$(mo "$DAVE" TSTB buy limit 5 9)
R=$(mo "$ALICE" TSTB sell market 5 NULL)
check "market sell fills bids inside the band" "$(cut -d'|' -f2-4 <<<"$R")" "5|9.0000|filled"
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$CAROL','trader');" >/dev/null
q service "SELECT public.post_cash_movement('$CAROL','deposit',1100,NULL,NULL,'$ADMIN');" >/dev/null
expect_err "market buy needs cash at worst allowed price" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$CAROL','TSTA','brand','buy','market',10,NULL);"
expect_err "open buys count against cash (no double spend)" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$CAROL','TSTA','brand','buy','limit',11,100); SELECT * FROM public.match_order('$CAROL','TSTA','brand','buy','limit',2,100);"

section "(d) self-trade prevention"
A1=$(mo_id "$DAVE" TSTD buy limit 5 99)
OWNBID=$(mo_id "$BOB" TSTD buy limit 1 95)
expect_err "sell crossing own resting bid refused" service "SELF_TRADE" "SELECT * FROM public.match_order('$BOB','TSTD','brand','sell','limit',5,95);"
expect_err "market sell that could reach own bid refused" service "SELF_TRADE" "SELECT * FROM public.match_order('$BOB','TSTD','brand','sell','market',5,NULL);"
B1=$(mo_id "$BOB" TSTD sell limit 5 96)
su_eq "non-crossing sell fills Dave's bid" "filled|5" "SELECT status, trim_scale(filled_qty) FROM public.orders WHERE id='$B1';"
BASK=$(mo_id "$BOB" TSTD sell limit 5 110)
expect_err "buy crossing own resting ask refused" service "SELF_TRADE" "SELECT * FROM public.match_order('$BOB','TSTD','brand','buy','limit',1,110);"
su_eq "own resting ask untouched" "open" "SELECT status FROM public.orders WHERE id='$BASK';"
su_eq "own resting bid untouched" "open" "SELECT status FROM public.orders WHERE id='$OWNBID';"
su_eq "no trade has the same buyer and seller" "0" "SELECT count(*) FROM public.trades WHERE buyer_id = seller_id;"
expect_eq "book is never crossed (best bid < best ask)" anon "t" "SELECT coalesce((SELECT max(price) FROM public.get_order_book('TSTD', 50) WHERE side='buy') < (SELECT min(price) FROM public.get_order_book('TSTD', 50) WHERE side='sell'), true);"

section "(d) order lifecycle: cancel / restore / modify (K4)"
# TSTA band stays [80, 120] all day; Bob's stale ask @130 (above it) is the only ask.
O1=$(mo_id "$ALICE" TSTA buy limit 10 100)
expect_err "users cannot call cancel_order" "$ALICE" "permission denied" "SELECT * FROM public.cancel_order(auth.uid(), '$O1');"
expect_err "cannot cancel someone else's order" service "ORDER_NOT_OPEN" "SELECT * FROM public.cancel_order('$BOB', '$O1');"
expect_eq "owner cancels open order" service "cancelled" "SELECT status FROM public.cancel_order('$ALICE', '$O1');"
expect_err "cannot cancel twice" service "ORDER_NOT_OPEN" "SELECT * FROM public.cancel_order('$ALICE', '$O1');"
su_eq "cancel audited with actor and states" "cancel|$ALICE|open|cancelled" "SELECT action || '|' || changed_by || '|' || previous_status || '|' || new_status FROM public.orders_audit WHERE order_id='$O1';"
expect_eq "owner reads own order audit" "$ALICE" "1" "SELECT count(*) FROM public.orders_audit WHERE order_id='$O1';"
expect_eq "others cannot read it" "$BOB" "0" "SELECT count(*) FROM public.orders_audit WHERE order_id='$O1';"
expect_err "cannot restore someone else's order" service "ORDER_NOT_OPEN" "SELECT * FROM public.restore_order('$BOB', '$O1');"
O2=$(q service "SELECT order_id FROM public.restore_order('$ALICE', '$O1');")
su_eq "restore places a NEW open order" "open|10|100.0000|true" "SELECT status || '|' || qty::int || '|' || price || '|' || (id <> '$O1') FROM public.orders WHERE id='$O2';"
su_eq "restored-from order stays cancelled" "cancelled" "SELECT status FROM public.orders WHERE id='$O1';"
expect_err "restore only once" service "ORDER_NOT_OPEN" "SELECT * FROM public.restore_order('$ALICE', '$O1');"
expect_err "restore of an open order refused" service "ORDER_NOT_OPEN" "SELECT * FROM public.restore_order('$ALICE', '$O2');"
expect_err "modify out of band fails" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.replace_order('$ALICE', '$O2', 500, 10);"
su_eq "failed modify leaves old order untouched" "open|10|100.0000" "SELECT status || '|' || qty::int || '|' || price FROM public.orders WHERE id='$O2';"
expect_err "cannot modify someone else's order" service "ORDER_NOT_OPEN" "SELECT * FROM public.replace_order('$BOB', '$O2', 101, 5);"
expect_err "modify validates qty" service "INVALID_QTY" "SELECT * FROM public.replace_order('$ALICE', '$O2', 101, 2.5);"
expect_err "modify validates price tick" service "INVALID_PRICE" "SELECT * FROM public.replace_order('$ALICE', '$O2', 101.001, 5);"
O3=$(q service "SELECT order_id FROM public.replace_order('$ALICE', '$O2', 101, 5);")
su_eq "modify = cancel old + new order" "cancelled|open|5|101.0000" "SELECT (SELECT status FROM public.orders WHERE id='$O2') || '|' || status || '|' || qty::int || '|' || price FROM public.orders WHERE id='$O3';"
su_eq "modify audited with replacement id" "modify|$O3" "SELECT action || '|' || related_order_id FROM public.orders_audit WHERE order_id='$O2' AND action='modify';"
expect_err "modified-away order cannot be restored" service "ORDER_NOT_OPEN" "SELECT * FROM public.restore_order('$ALICE', '$O2');"
MX=$(mo_id "$BOB" TSTA sell limit 10 118)
R=$(q service "SELECT status || '|' || trim_scale(filled_qty) FROM public.replace_order('$ALICE', '$O3', 118, 10);")
check "modify into a crossing price matches immediately" "$R" "filled|10"
su_eq "stale ask above the band is never reached" "open|0" "SELECT status || '|' || trim_scale(filled_qty) FROM public.orders WHERE user_id='$BOB' AND price=130;"
su_eq "no 'modified' status produced" "0" "SELECT count(*) FROM public.orders WHERE status='modified';"

# ------------------------------------------------------------ (e) Shariah ---
section "(e) Shariah rulings in the engine"
BUYD=$(mo_id "$DAVE" TSTA buy limit 3 110)
SELLB=$(mo_id "$BOB" TSTA sell limit 5 115)
expect_err "board cannot forge reviewer_id" "$BOARD" "permission denied" "INSERT INTO public.shariah_decisions (symbol, status, reviewer_id) VALUES ('TSTA','non_halal','$ALICE');"
expect_err "non-board cannot rule" "$ALICE" "row-level security" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTA','halal');"
DEC=$(q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('tsta','non_halal','test') RETURNING id;")
su_eq "ruling stamped with session user, symbol normalized" "TSTA|$BOARD" "SELECT symbol || '|' || reviewer_id FROM public.shariah_decisions WHERE id='$DEC';"
su_eq "non_halal ruling cancels resting buys" "cancelled" "SELECT status FROM public.orders WHERE id='$BUYD';"
su_eq "Shariah cancellation audited" "shariah_cancel|$BOARD" "SELECT action || '|' || changed_by FROM public.orders_audit WHERE order_id='$BUYD';"
su_eq "no resting buys left on the symbol" "0" "SELECT count(*) FROM public.orders WHERE symbol='TSTA' AND side='buy' AND status IN ('open','partial');"
su_eq "resting sells on the symbol are kept" "open" "SELECT status FROM public.orders WHERE id='$SELLB';"
q service "SELECT * FROM public.cancel_order('$BOB', '$SELLB');" >/dev/null
expect_err "buy on non_halal symbol blocked" service "SHARIAH_BLOCKED" "SELECT * FROM public.match_order('$DAVE','TSTA','brand','buy','limit',1,100);"
expect_err "market buy on non_halal symbol blocked" service "SHARIAH_BLOCKED" "SELECT * FROM public.match_order('$DAVE','TSTA','brand','buy','market',1,NULL);"
expect_err "restore of a buy blocked too" service "SHARIAH_BLOCKED" "SELECT * FROM public.restore_order('$DAVE','$BUYD');"
R=$(mo "$BOB" TSTA sell limit 5 118)
check "sell on non_halal symbol still accepted (holders can exit)" "$(cut -d'|' -f4 <<<"$R")" "open"
q service "SELECT * FROM public.cancel_order('$BOB', '$(cut -d'|' -f1 <<<"$R")');" >/dev/null
su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$DAVE','TSTA','buy','limit',2,119,'open',0);" >/dev/null
R=$(mo "$ALICE" TSTA sell limit 2 119)
check "resting (legacy) buy on non_halal symbol never filled" "$(cut -d'|' -f2,4 <<<"$R")" "0|open"
q service "SELECT * FROM public.cancel_order('$ALICE', '$(cut -d'|' -f1 <<<"$R")');" >/dev/null
expect_ok "board updates status/reason" "$BOARD" "UPDATE public.shariah_decisions SET status='reviewing', reason='re-check' WHERE id='$DEC';"
su_eq "decision audit changed_by = session user" "$BOARD|non_halal|reviewing" "SELECT changed_by || '|' || previous_status || '|' || new_status FROM public.shariah_decision_audit WHERE decision_id='$DEC';"
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTA','non_halal');" >/dev/null
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTA','halal');" >/dev/null
expect_eq "latest ruling wins (non_halal then halal)" service "halal" "SELECT public.current_shariah_status('TSTA');"
R=$(mo "$DAVE" TSTA buy limit 1 120)
check "buy allowed again after a later halal ruling" "$(cut -d'|' -f4 <<<"$R")" "open"
DBUY=$(cut -d'|' -f1 <<<"$R")
# Editing an OLDER ruling row puts that change in force (most recent change wins).
expect_ok "board edits the older ruling row to non_halal" "$BOARD" "UPDATE public.shariah_decisions SET status='non_halal', reason='re-review' WHERE id='$DEC';"
expect_eq "edited older row is the ruling in force" service "non_halal" "SELECT public.current_shariah_status('TSTA');"
su_eq "resting buy cancelled by the edit" "cancelled" "SELECT status FROM public.orders WHERE id='$DBUY';"
expect_err "buys blocked after the edit" service "SHARIAH_BLOCKED" "SELECT * FROM public.match_order('$DAVE','TSTA','brand','buy','limit',1,100);"
expect_ok "reason-only edit of an older row" "$BOARD" "UPDATE public.shariah_decisions SET reason='typo fixed' WHERE id=(SELECT id FROM public.shariah_decisions WHERE symbol='TSTA' AND status='halal' ORDER BY created_at LIMIT 1);"
expect_eq "reason-only edit does not change the ruling in force" service "non_halal" "SELECT public.current_shariah_status('TSTA');"
expect_err "effective_at is not client-writable" "$BOARD" "permission denied" "UPDATE public.shariah_decisions SET effective_at = now() + interval '1 day' WHERE id='$DEC';"
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTA','halal');" >/dev/null
expect_eq "a new halal ruling is in force again" service "halal" "SELECT public.current_shariah_status('TSTA');"
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTH','halal');" >/dev/null
HB=$(mo_id "$GUS" TSTH buy limit 5 100)
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('TSTH','non_halal');" >/dev/null
expect_eq "latest ruling wins (halal then non_halal)" service "non_halal" "SELECT public.current_shariah_status('TSTH');"
su_eq "later non_halal ruling cancels the resting buy" "cancelled" "SELECT status FROM public.orders WHERE id='$HB';"
expect_err "later non_halal ruling blocks new buys" service "SHARIAH_BLOCKED" "SELECT * FROM public.match_order('$GUS','TSTH','brand','buy','limit',1,100);"
R=$(mo "$ERIN" TSTH sell limit 5 100)
check "holder can still sell after non_halal" "$(cut -d'|' -f4 <<<"$R")" "open"

# ------------------------------------------- (f) onboarding / cash ledger ---
section "(f) new users, cash defaults and ledger reconciliation (K7)"
su_eq "portfolios.cash_balance defaults to 0" "0" "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='portfolios' AND column_name='cash_balance';"
NEWU=$(newuser newbie@test.local)
su_eq "new user gets no trader role" "0" "SELECT count(*) FROM public.user_roles WHERE user_id='$NEWU';"
su_eq "new user still gets a profile" "1" "SELECT count(*) FROM public.profiles WHERE id='$NEWU';"
su_eq "new user has no portfolio / cash" "0" "SELECT count(*) FROM public.portfolios WHERE user_id='$NEWU';"
expect_err "new user cannot trade before activation" service "FORBIDDEN_TRADER_REQUIRED" "SELECT * FROM public.match_order('$NEWU','TSTA','brand','buy','limit',1,100);"
NEWP=$(newuser newport@test.local)
su "INSERT INTO public.portfolios (user_id) VALUES ('$NEWP');" >/dev/null
su_eq "a portfolio created without a balance starts at 0" "0.00" "SELECT cash_balance FROM public.portfolios WHERE user_id='$NEWP';"
expect_eq "admin deposit creates a portfolio from 0" service "250.50" "SELECT public.post_cash_movement('$NEWU','deposit',250.50,NULL,NULL,'$ADMIN');"
expect_err "sub-cent cash movement refused" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$NEWU','deposit',0.001,NULL,NULL,'$ADMIN');"
expect_err "withdrawal cannot overdraw" service "INSUFFICIENT_CASH" "SELECT public.post_cash_movement('$NEWU','withdrawal',-1000,NULL,NULL,'$ADMIN');"
LEG1=$(newuser legacy1@test.local); LEG2=$(newuser legacy2@test.local); LEG3=$(newuser legacy3@test.local)
su "INSERT INTO public.portfolios (user_id, cash_balance, created_at) VALUES ('$LEG1',100000,now()-interval '30 days'), ('$LEG2',100000,now()-interval '30 days'), ('$LEG3',100000,now()-interval '30 days');" >/dev/null
q service "SELECT public.post_cash_movement('$LEG2','deposit',500,NULL,NULL,'$ADMIN');" >/dev/null
q service "SELECT public.post_cash_movement('$LEG3','deposit',500,NULL,NULL,'$ADMIN');" >/dev/null
su "UPDATE public.portfolios SET cash_balance = 200000 WHERE user_id='$LEG3';" >/dev/null   # changed outside the ledger
RECON=$(ls "$REPO"/supabase/migrations/*_cash_opening_balance.sql 2>/dev/null | head -1)
if [ -n "$RECON" ] && out=$("${PSQL[@]}" -1 -f "$RECON" 2>&1 >/dev/null); then ok "opening balance migration re-applies cleanly"
else bad "opening balance migration re-applies cleanly" "${RECON:-*_cash_opening_balance.sql not found} ${out:-}"; fi
su_eq "reconciliation keeps balances" "100000.00|100500.00|200000.00" "SELECT string_agg(cash_balance::text, '|' ORDER BY user_id = '$LEG1' DESC, user_id = '$LEG2' DESC) FROM public.portfolios WHERE user_id IN ('$LEG1','$LEG2','$LEG3');"
su_eq "every ledger now sums to its balance" "0" "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);"
su_eq "every newest balance_after equals the balance" "0" "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> coalesce((SELECT balance_after FROM public.cash_ledger l WHERE l.user_id = p.user_id ORDER BY created_at DESC, id DESC LIMIT 1), 0);"
su_eq "opening balance dated before first movement" "adjustment|100000|100000|true" "SELECT kind || '|' || amount::int || '|' || balance_after::int || '|' || (created_at < (SELECT min(created_at) FROM public.cash_ledger WHERE user_id='$LEG2' AND kind='deposit')) FROM public.cash_ledger WHERE user_id='$LEG2' AND note='opening balance reconciliation';"
su_eq "out-of-ledger change booked now" "199500|200000" "SELECT amount::int || '|' || balance_after::int FROM public.cash_ledger WHERE user_id='$LEG3' AND note='opening balance reconciliation';"
su_eq "reconciliation is idempotent" "3" "SELECT count(*) FROM public.cash_ledger WHERE note='opening balance reconciliation' AND user_id IN ('$LEG1','$LEG2','$LEG3');"

# ------------------------------------------------ (i) public market data ---
section "(i) market data comes from trades only"
LAST=$(su "SELECT price FROM public.trades WHERE symbol='TSTA' ORDER BY created_at DESC, id DESC LIMIT 1;")
expect_err "user cannot print a trade to move the last price" "$ALICE" "permission denied" "INSERT INTO public.trades (symbol, qty, price, buyer_id, seller_id) VALUES ('TSTA',1,99999,auth.uid(),auth.uid());"
expect_err "user cannot insert a filled order to move stats" "$ALICE" "permission denied" "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty, filled_price, filled_at) VALUES (auth.uid(),'TSTA','buy','limit',99999,1,'filled',99999,1,now());"
su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty, filled_price, filled_at) VALUES ('$ALICE','TSTA','buy','limit',99999,1,'filled',99999,1,now());" >/dev/null
expect_eq "last price from trades, not orders (anon)" anon "$LAST" "SELECT last_price FROM public.get_symbol_last_trade('TSTA');"
VOL=$(su "SELECT sum(qty) || '|' || count(*) FROM public.trades WHERE symbol='TSTA';")
expect_eq "stats: last price, volume counted once per trade" "$ALICE" "$LAST|$VOL" "SELECT last_price || '|' || volume_24h || '|' || trade_count_24h FROM public.get_symbol_market_stats('TSTA');"
FIRST=$(su "SELECT price FROM public.trades WHERE symbol='TSTA' ORDER BY created_at, id LIMIT 1;")
expect_eq "stats: change vs first trade in window" "$ALICE" "$(su "SELECT round(($LAST - $FIRST) / $FIRST * 100, 2);")" "SELECT change_24h_pct FROM public.get_symbol_market_stats('TSTA');"
expect_eq "snapshot agrees" "$ALICE" "TSTA|$LAST|$(cut -d'|' -f1 <<<"$VOL")" "SELECT symbol || '|' || last_price || '|' || volume_24h FROM public.get_market_snapshot(ARRAY['TSTA']);"
expect_eq "snapshot: no trades -> null price, zero volume" "$ALICE" "TSTC||0" "SELECT symbol || '|' || coalesce(last_price::text,'') || '|' || volume_24h FROM public.get_market_snapshot(ARRAY['TSTC']);"
expect_err "anon cannot call market stats" anon "permission denied" "SELECT * FROM public.get_symbol_market_stats('TSTA');"
su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) SELECT '$BOB','TSTD','sell','limit',1,100+g,'open',0 FROM generate_series(1,60) g;" >/dev/null
expect_eq "order book depth capped at 50" anon "50" "SELECT count(*) FROM public.get_order_book('TSTD', 1000) WHERE side='sell';"
su_eq "order book exposes no user or order ids" "_symbol,_depth,side,price,qty" "SELECT array_to_string(proargnames, ',') FROM pg_proc WHERE oid = 'public.get_order_book(text, integer)'::regprocedure;"

# ------------------------------------------------- (c) read isolation ---
section "(c) users read their own money data and nobody else's"
for t in portfolios positions orders cash_ledger; do
  mine=$(su "SELECT count(*) FROM public.$t WHERE user_id='$ALICE';")
  expect_eq "trader reads own $t ($mine rows)" "$ALICE" "$mine|0" "SELECT count(*) FILTER (WHERE user_id = auth.uid()) || '|' || count(*) FILTER (WHERE user_id <> auth.uid()) FROM public.$t;"
  expect_eq "user with no data sees no $t rows" "$OWNER" "0" "SELECT count(*) FROM public.$t;"
done
check "fixtures give Alice rows in every money table" "$(su "SELECT (SELECT count(*) FROM public.positions WHERE user_id='$ALICE') > 0 AND (SELECT count(*) FROM public.orders WHERE user_id='$ALICE') > 0 AND (SELECT count(*) FROM public.cash_ledger WHERE user_id='$ALICE') > 1;")" "t"
MYTRADES=$(su "SELECT count(*) FROM public.trades WHERE buyer_id='$ALICE' OR seller_id='$ALICE';")
expect_eq "trader reads exactly own trades ($MYTRADES)" "$ALICE" "$MYTRADES" "SELECT count(*) FROM public.trades;"
expect_eq "non-participant reads no trades" "$OWNER" "0" "SELECT count(*) FROM public.trades;"
expect_eq "cannot read another user's portfolio by id" "$BOB" "0" "SELECT count(*) FROM public.portfolios WHERE user_id='$ALICE';"
expect_eq "cannot read another user's ledger by id" "$BOB" "0" "SELECT count(*) FROM public.cash_ledger WHERE user_id='$ALICE';"
expect_eq "cannot read another user's roles" "$BOB" "0" "SELECT count(*) FROM public.user_roles WHERE user_id='$ALICE';"
expect_eq "cannot read another user's price alerts" "$BOB" "0" "SELECT count(*) FROM public.price_alerts WHERE user_id='$ALICE';"

# ----------------------------------------- (g) governance + tenant isolation ---
section "(g) governance: audit log, brands, submissions, documents, owners"
expect_ok "service writes audit_log" service "INSERT INTO public.audit_log (actor_id, action, entity) VALUES ('$ALICE','x','y');"
expect_eq "actor reads own audit rows" "$ALICE" "1" "SELECT count(*) FROM public.audit_log;"
expect_err "users cannot delete audit_log" "$ADMIN" "permission denied" "DELETE FROM public.audit_log;"
expect_err "access request length limits" service "access_requests_text_lengths" "INSERT INTO public.access_requests (email, full_name, join_method, new_company_name_ar, new_company_name_en) VALUES (repeat('a',321),'A','new_company','x','y');"
expect_err "company owner cannot change symbol" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET symbol='HACK' WHERE symbol='TSTC';"
expect_err "company owner cannot change slug" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET slug='hack' WHERE symbol='TSTC';"
expect_err "company owner cannot publish/unpublish" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET published=false WHERE symbol='TSTC';"
expect_err "company owner cannot move reference price" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET reference_price=1 WHERE symbol='TSTC';"
expect_err "company owner cannot move the brand to another company" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET company_id='$CO2' WHERE symbol='TSTC';"
expect_err "company owner cannot detach the brand" "$OWNER" "FORBIDDEN_BRAND_FIELD" "UPDATE public.brands SET company_id=NULL WHERE symbol='TSTC';"
su_eq "brand protected fields unchanged" "TSTC|tstc|true|50|$CO" "SELECT symbol || '|' || slug || '|' || published || '|' || reference_price || '|' || company_id FROM public.brands WHERE symbol='TSTC';"
expect_eq "company owner edits descriptive fields" "$OWNER" "Renamed C" "UPDATE public.brands SET name_en='Renamed C', sector='tech' WHERE symbol='TSTC' RETURNING name_en;"
expect_eq "platform admin may move reference price" "$ADMIN" "55" "UPDATE public.brands SET reference_price=55 WHERE symbol='TSTC' RETURNING reference_price;"
expect_eq "service role may change protected fields" service "t" "UPDATE public.brands SET published=true WHERE symbol='TSTC' RETURNING published;"
expect_eq "other users cannot edit brands" "$ALICE" "" "UPDATE public.brands SET name_en='x' WHERE symbol='TSTC' RETURNING name_en;"
expect_eq "other company's owner cannot edit brands" "$OWNER2" "" "UPDATE public.brands SET name_en='x' WHERE symbol='TSTC' RETURNING name_en;"
SUB=$(q "$OWNER" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en, status, reviewer_id, review_reason, reviewed_at) VALUES ('$CO','$ALICE','brand','NEWB','n','n','approved','$BOARD','ok',now()) RETURNING id;")
su_eq "submission forced to pending, submitter = session user" "pending|||$OWNER" "SELECT status || '|' || coalesce(reviewer_id::text,'') || '|' || coalesce(review_reason,'') || '|' || submitted_by FROM public.product_submissions WHERE id='$SUB';"
expect_err "submitter cannot change company of submission" "$OWNER" "permission denied" "UPDATE public.product_submissions SET company_id = gen_random_uuid() WHERE id='$SUB';"
expect_eq "submitter cannot approve own submission" "$OWNER" "" "UPDATE public.product_submissions SET status='approved' WHERE id='$SUB' RETURNING status;"
expect_err "viewer cannot submit for the company" "$VIEWER" "row-level security" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en) VALUES ('$CO',auth.uid(),'brand','VWR','v','v');"
expect_err "owner cannot submit for another company" "$OWNER2" "row-level security" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en) VALUES ('$CO',auth.uid(),'brand','XCO','x','x');"
expect_err "approval without the listed brand refused" "$BOARD" "BRAND_NOT_LISTED" "UPDATE public.product_submissions SET status='approved' WHERE id='$SUB';"
expect_err "reviewer cannot move a submission to an unknown status" "$BOARD" "SUBMISSION_NOT_PENDING|product_submissions_status_check" "UPDATE public.product_submissions SET status='listed' WHERE id='$SUB';"
q service "INSERT INTO public.brands (symbol, slug, name_ar, name_en, published, company_id, source_submission_id) VALUES ('NEWB','newb','n','n',true,'$CO','$SUB');" >/dev/null
expect_eq "board review stamps reviewer" "$BOARD" "approved|$BOARD" "UPDATE public.product_submissions SET status='approved', reviewer_id='$ALICE' WHERE id='$SUB' RETURNING status || '|' || reviewer_id;"
expect_err "decision cannot be reverted to pending" "$BOARD" "SUBMISSION_NOT_PENDING" "UPDATE public.product_submissions SET status='pending' WHERE id='$SUB';"
expect_err "decision cannot be flipped to rejected" "$BOARD" "SUBMISSION_NOT_PENDING" "UPDATE public.product_submissions SET status='rejected', review_reason='changed my mind' WHERE id='$SUB';"
expect_err "decided submission's reason is frozen" "$BOARD" "SUBMISSION_NOT_PENDING" "UPDATE public.product_submissions SET review_reason='rewritten' WHERE id='$SUB';"
SUB2=$(su "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en) VALUES ('$CO2','$OWNER2','brand','OTH','o','o') RETURNING id;" | head -1)
expect_ok "document under <company>/<submission>/ accepted" "$OWNER" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB','$CO','a.pdf','$CO/$SUB/x-a..b.pdf',auth.uid());"
expect_err "document path outside the submission folder" "$OWNER" "INVALID_FILE_PATH" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB','$CO','a.pdf','$CO2/$SUB2/a.pdf',auth.uid());"
expect_err "document path with extra folders" "$OWNER" "INVALID_FILE_PATH" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB','$CO','a.pdf','$CO/$SUB/../x/a.pdf',auth.uid());"
expect_err "document path with empty name" "$OWNER" "INVALID_FILE_PATH" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB','$CO','a.pdf','$CO/$SUB/',auth.uid());"
expect_err "document for another company's submission" "$OWNER" "SUBMISSION_NOT_FOUND" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB2','$CO','a.pdf','$CO/$SUB2/a.pdf',auth.uid());"
expect_err "document into another company" "$OWNER" "row-level security" "INSERT INTO public.submission_documents (submission_id, company_id, file_name, file_path, uploaded_by) VALUES ('$SUB2','$CO2','a.pdf','$CO2/$SUB2/a.pdf',auth.uid());"

section "(c) tenant isolation between two companies"
q service "INSERT INTO public.audit_log (actor_id, company_id, action, entity) VALUES ('$ADMIN','$CO','co1.event','x'), ('$ADMIN','$CO2','co2.event','x');" >/dev/null
expect_eq "owner sees only own company" "$OWNER2" "other" "SELECT string_agg(slug, ',') FROM public.companies;"
expect_eq "other company's members invisible" "$OWNER2" "0" "SELECT count(*) FROM public.company_members WHERE company_id='$CO';"
expect_eq "own company's members visible" "$OWNER2" "1" "SELECT count(*) FROM public.company_members WHERE company_id='$CO2';"
expect_eq "other company's submissions invisible" "$OWNER2" "0" "SELECT count(*) FROM public.product_submissions WHERE company_id='$CO';"
expect_eq "own company's submissions visible" "$OWNER2" "1" "SELECT count(*) FROM public.product_submissions WHERE company_id='$CO2';"
expect_eq "other company's documents invisible" "$OWNER2" "0" "SELECT count(*) FROM public.submission_documents WHERE company_id='$CO';"
expect_eq "company owner reads only own company's audit rows" "$OWNER2" "co2.event" "SELECT string_agg(action, ',') FROM public.audit_log;"
expect_eq "and the reverse" "$OWNER" "co1.event" "SELECT string_agg(action, ',') FROM public.audit_log WHERE company_id IS NOT NULL;"
expect_eq "viewer (non-owner) does not read company audit rows" "$VIEWER" "0" "SELECT count(*) FROM public.audit_log;"
expect_eq "other company's invitations invisible" "$OWNER2" "0" "SELECT count(*) FROM public.company_invitations WHERE company_id='$CO';"
expect_eq "outsider sees no company at all" "$ALICE" "0" "SELECT count(*) FROM public.companies;"
expect_eq "unpublished company brand invisible to other tenants" "$OWNER2" "0" "SELECT count(*) FROM public.brands WHERE company_id='$CO' AND NOT published;"

section "(g) last owner protection"
expect_err "last owner cannot leave" "$OWNER" "LAST_OWNER_PROTECTED" "DELETE FROM public.company_members WHERE company_id='$CO' AND user_id=auth.uid();"
expect_err "last owner cannot be demoted" "$OWNER" "LAST_OWNER_PROTECTED" "UPDATE public.company_members SET role='viewer' WHERE company_id='$CO' AND user_id=auth.uid();"
su "INSERT INTO public.company_members (company_id, user_id, role) VALUES ('$CO2','$OWNER','owner');" >/dev/null
# Race: two owners of CO2 remove each other at the same time -> exactly one wins.
( printf "BEGIN;\nDELETE FROM public.company_members WHERE company_id='%s' AND user_id='%s';\nSELECT pg_sleep(2) AS race_holder;\nCOMMIT;\n" "$CO2" "$OWNER2" | "${PSQL[@]}" >"$WORK/race1.out" 2>&1 ) &
# wait until the first transaction has deleted its row and is holding its locks
for _ in $(seq 1 100); do
  [ "$(su "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%race_holder%' AND state = 'active' AND pid <> pg_backend_pid();")" == 1 ] && break
  sleep 0.05
done
RACE2=$(su "DELETE FROM public.company_members WHERE company_id='$CO2' AND user_id='$OWNER';")
wait
if grep -q LAST_OWNER_PROTECTED <<<"$RACE2" && [ "$(su "SELECT count(*) FROM public.company_members WHERE company_id='$CO2' AND role='owner';")" == "1" ]; then
  ok "concurrent owner removals serialized (one owner left)"
else bad "concurrent owner removal race" "$RACE2 / $(cat "$WORK/race1.out")"; fi
su "DELETE FROM public.companies WHERE id='$CO2';" >/dev/null
su_eq "company deleted with its last owner" "0" "SELECT count(*) FROM public.companies WHERE id='$CO2';"

# ---------------------------------------------- (h) approve_access_request ---
section "(h) approve_access_request"
REQ1=$(q service "INSERT INTO public.access_requests (email, full_name, join_method, new_company_name_ar, new_company_name_en) VALUES ('founder@test.local','F','new_company','جديد','NewCo') RETURNING id;")
expect_err "new company: non-admin refused" service "FORBIDDEN" "SELECT * FROM public.approve_access_request('$REQ1','$OWNER',NULL,'tech','newco');"
expect_err "new company: slug taken" service "SLUG_TAKEN" "SELECT * FROM public.approve_access_request('$REQ1','$ADMIN',NULL,'tech','acme');"
expect_err "new company: slug and sector required" service "SLUG_AND_SECTOR_REQUIRED" "SELECT * FROM public.approve_access_request('$REQ1','$ADMIN',NULL,NULL,NULL);"
R=$(q service "SELECT invitation_id || '|' || company_id FROM public.approve_access_request('$REQ1','$ADMIN',NULL,'tech','newco');")
NEWCO=$(cut -d'|' -f2 <<<"$R")
if grep -qE '^[0-9a-f-]{36}\|[0-9a-f-]{36}$' <<<"$R"; then ok "new-company request approved"; else bad "new-company request approved" "$R"; fi
su_eq "new company created without the admin as member" "newco|0|tech" "SELECT slug || '|' || (SELECT count(*) FROM public.company_members WHERE company_id=c.id) || '|' || sector FROM public.companies c WHERE id='$NEWCO';"
su_eq "applicant invited as owner" "owner|founder@test.local|pending" "SELECT role || '|' || email || '|' || status FROM public.company_invitations WHERE company_id='$NEWCO';"
expect_eq "admin can read the new company and invitation" "$ADMIN" "1|1" "SELECT (SELECT count(*) FROM public.companies WHERE id='$NEWCO') || '|' || (SELECT count(*) FROM public.company_invitations WHERE company_id='$NEWCO');"
FOUNDER=$(newuser founder@test.local)
TOKEN=$(su "SELECT token FROM public.company_invitations WHERE company_id='$NEWCO';")
expect_err "invitation cannot be accepted by another email" service "INVITATION_EMAIL_MISMATCH" "SELECT public.accept_company_invitation('$TOKEN','$ALICE','alice@test.local');"
expect_eq "applicant accepts and becomes owner" service "$NEWCO" "SELECT public.accept_company_invitation('$TOKEN','$FOUNDER','founder@test.local');"
su_eq "founder is the only owner" "$FOUNDER" "SELECT string_agg(user_id::text, ',') FROM public.company_members WHERE company_id='$NEWCO' AND role='owner';"
su_eq "founder did not become a trader" "0" "SELECT count(*) FROM public.user_roles WHERE user_id='$FOUNDER';"
REQ2=$(q service "INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id) VALUES ('joiner@test.local','J','search','$CO') RETURNING id;")
expect_err "join: role required" service "ROLE_REQUIRED" "SELECT * FROM public.approve_access_request('$REQ2','$OWNER',NULL,NULL,NULL);"
expect_err "join: other company's owner refused" service "FORBIDDEN" "SELECT * FROM public.approve_access_request('$REQ2','$FOUNDER','viewer',NULL,NULL);"
expect_err "join: plain member refused" service "FORBIDDEN" "SELECT * FROM public.approve_access_request('$REQ2','$VIEWER','viewer',NULL,NULL);"
R=$(q service "SELECT company_id FROM public.approve_access_request('$REQ2','$OWNER','viewer',NULL,NULL);")
check "join-company request approved by the company owner" "$R" "$CO"
su_eq "join invitation carries the assigned role" "viewer|joiner@test.local|pending" "SELECT role || '|' || email || '|' || status FROM public.company_invitations WHERE company_id='$CO' AND email='joiner@test.local';"
su_eq "requests marked approved" "approved|approved" "SELECT string_agg(status, '|' ORDER BY id = '$REQ1' DESC) FROM public.access_requests WHERE id IN ('$REQ1','$REQ2');"
expect_err "approve twice refused" service "REQUEST_NOT_PENDING" "SELECT * FROM public.approve_access_request('$REQ2','$OWNER','viewer',NULL,NULL);"

# ------------------------------------------ (j) investor deactivation ---
section "(j) deactivated investors cannot trade, not even as the passive side"
EO=$(mo_id "$ERIN" TSTP sell limit 5 101)
EO2=$(mo_id "$ERIN" TSTH sell limit 1 101)
expect_err "only a platform admin can deactivate" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT public.deactivate_trader('$ERIN', '$BOB');"
expect_err "users cannot call deactivate_trader" "$ADMIN" "permission denied" "SELECT public.deactivate_trader('$ERIN', '$ADMIN');"
N=$(q service "SELECT public.deactivate_trader('$ERIN', '$ADMIN');")
if [ "$N" -ge 2 ] 2>/dev/null; then ok "deactivation cancels the investor's resting orders ($N)"; else bad "deactivation cancels the investor's resting orders" "$N"; fi
su_eq "role revoked, orders cancelled and audited" "false|0|deactivate_cancel|$ADMIN" "SELECT public.has_role('$ERIN','trader') || '|' || (SELECT count(*) FROM public.orders WHERE user_id='$ERIN' AND status IN ('open','partial')) || '|' || (SELECT action || '|' || changed_by FROM public.orders_audit WHERE order_id='$EO');"
expect_err "deactivated investor cannot place orders" service "FORBIDDEN_TRADER_REQUIRED" "SELECT * FROM public.match_order('$ERIN','TSTP','brand','sell','limit',1,100);"
expect_eq "deactivated investor can still read their cancelled orders" "$ERIN" "cancelled" "SELECT status FROM public.orders WHERE id='$EO2';"
# Backstop: a role removed outside deactivate_trader() (e.g. by hand).
FO=$(mo_id "$FRANK" TSTP sell limit 5 100)
su "DELETE FROM public.user_roles WHERE user_id='$FRANK' AND role='trader';" >/dev/null
TR0=$(su "SELECT count(*) FROM public.trades;")
R=$(mo "$GUS" TSTP buy limit 5 100)
check "crossing buy does not fill the inactive investor's ask" "$(cut -d'|' -f2,4 <<<"$R")" "0|open"
su_eq "inactive investor's resting ask cancelled by the engine" "cancelled|engine_cancel_inactive_trader" "SELECT status || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$FO') FROM public.orders WHERE id='$FO';"
su_eq "no trade with the inactive investor" "$TR0" "SELECT count(*) FROM public.trades;"
q service "SELECT * FROM public.cancel_order('$GUS', '$(cut -d'|' -f1 <<<"$R")');" >/dev/null
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$FRANK','trader'), ('$ERIN','trader');" >/dev/null

# ---------------------------------------- (k) price band anchoring ---
section "(k) the price band is anchored on the previous close, not today's trades"
q service "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('TSTW','tstw','w','Test W',100,true);" >/dev/null
q service "SELECT public.issue_units('$ADMIN','$FRANK','TSTW',100,150,'band test');" >/dev/null
expect_eq "no trade yet: band reference = listing reference price" service "100" "SELECT trim_scale(public.band_reference_price('TSTW'));"
# A trade before today (Asia/Riyadh) is the previous close (buyer = seller so
# units stay conserved in this fixture).
su "INSERT INTO public.trades (symbol, asset_class, qty, price, buyer_id, seller_id, created_at) VALUES ('TSTW','brand',1,150,'$GUS','$GUS', now() - interval '2 days');" >/dev/null
expect_eq "previous close becomes the band reference" service "150" "SELECT trim_scale(public.band_reference_price('TSTW'));"
expect_err "limit below previous close -20% refused" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$GUS','TSTW','brand','buy','limit',1,119.99);"
R=$(mo "$FRANK" TSTW sell limit 1 180); R=$(mo "$GUS" TSTW buy limit 1 180)
check "trade at the top of the band" "$(cut -d'|' -f2-4 <<<"$R")" "1|180.0000|filled"
expect_eq "today's trade does not move the band reference" service "150" "SELECT trim_scale(public.band_reference_price('TSTW'));"
expect_err "band cannot be walked by consecutive trades (next step refused)" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$FRANK','TSTW','brand','sell','limit',1,216);"
for i in 1 2 3; do mo "$FRANK" TSTW sell limit 1 180 >/dev/null; mo "$GUS" TSTW buy limit 1 180 >/dev/null; done
expect_err "still refused after repeated wash trades at the band top" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$GUS','TSTW','brand','buy','limit',1,180.01);"
# A resting ask priced below the band (legacy / earlier day) trades at the band floor.
LOWASK=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$FRANK','TSTW','sell','limit',1,100,'open',0) RETURNING id;" | head -1)
R=$(mo "$GUS" TSTW buy limit 1 125)
check "execution price kept inside the band (floor 120, not 100)" "$(cut -d'|' -f2-4 <<<"$R")" "1|120.0000|filled"
su_eq "clamped execution price stored on the tick (trade and ledger note)" "120.00|120.00" "SELECT (SELECT price::text FROM public.trades WHERE sell_order_id='$LOWASK') || '|' || (SELECT split_part(note, ' @ ', 2) FROM public.cash_ledger WHERE ref_order_id='$LOWASK');"
su_eq "every TSTW trade today is inside [120, 180]" "0" "SELECT count(*) FROM public.trades WHERE symbol='TSTW' AND created_at > now() - interval '1 day' AND (price < 120 OR price > 180);"
LOWBID=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$GUS','TSTW','buy','limit',1,500,'open',0) RETURNING id;" | head -1)
R=$(mo "$FRANK" TSTW sell market 1 NULL)
check "resting bid above the band trades at the band ceiling" "$(cut -d'|' -f2-4 <<<"$R")" "1|180.0000|filled"
su_eq "ceiling execution price stored on the tick" "180.00" "SELECT price::text FROM public.trades WHERE buy_order_id='$LOWBID';"

# ------------------------------------------ (l) buying power race ---
section "(l) concurrent orders of one trader are checked one after the other"
RACER=$(newuser racer@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$RACER','trader');" >/dev/null
q service "SELECT public.post_cash_movement('$RACER','deposit',1000,NULL,NULL,'$ADMIN');" >/dev/null
( printf "BEGIN;\nSET LOCAL ROLE service_role;\nSELECT status FROM public.match_order('%s','TSTP','brand','buy','limit',9,100);\nSELECT pg_sleep(2) AS bp_race_holder;\nCOMMIT;\n" "$RACER" | "${PSQL[@]}" >"$WORK/race2.out" 2>&1 ) &
for _ in $(seq 1 100); do
  [ "$(su "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%bp_race_holder%' AND state = 'active' AND pid <> pg_backend_pid();")" == 1 ] && break
  sleep 0.05
done
RACE3=$(q service "SELECT status FROM public.match_order('$RACER','TSTD','brand','buy','limit',9,100);")
wait
if grep -q INSUFFICIENT_CASH <<<"$RACE3" && grep -q open "$WORK/race2.out"; then ok "second concurrent buy sees the first one's reservation"
else bad "concurrent buys on two symbols both passed the buying-power check" "$RACE3 / $(cat "$WORK/race2.out")"; fi
su_eq "resting buys never exceed cash" "t" "SELECT (SELECT coalesce(sum((qty - filled_qty) * price), 0) FROM public.orders WHERE user_id='$RACER' AND side='buy' AND status IN ('open','partial')) <= (SELECT cash_balance FROM public.portfolios WHERE user_id='$RACER');"

# ------------------------------------------ (n) primary issuance ---
section "(n) primary issuance of brand units"
expect_err "only a platform admin issues units" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT public.issue_units('$BOB','$GUS','TSTP',10,100,NULL);"
expect_err "issuance: whole units only" service "INVALID_QTY" "SELECT public.issue_units('$ADMIN','$GUS','TSTP',1.5,100,NULL);"
expect_err "issuance: price on the tick" service "INVALID_PRICE" "SELECT public.issue_units('$ADMIN','$GUS','TSTP',1,100.001,NULL);"
expect_err "issuance: published instruments only" service "INSTRUMENT_NOT_FOUND" "SELECT public.issue_units('$ADMIN','$GUS','TSTU',1,100,NULL);"
expect_err "issuance: existing users only" service "USER_NOT_FOUND" "SELECT public.issue_units('$ADMIN',gen_random_uuid(),'TSTP',1,100,NULL);"
expect_err "users cannot call issue_units" "$ADMIN" "permission denied" "SELECT public.issue_units('$ADMIN','$ADMIN','TSTP',1,100,NULL);"
expect_err "users cannot write unit_issuances" "$ADMIN" "permission denied" "INSERT INTO public.unit_issuances (symbol, user_id, qty, price, issued_by) VALUES ('TSTP', auth.uid(), 1, 1, auth.uid());"
expect_eq "holder reads own issuances only" "$BOB" "2|0" "SELECT count(*) FILTER (WHERE user_id = auth.uid()) || '|' || count(*) FILTER (WHERE user_id <> auth.uid()) FROM public.unit_issuances;"
expect_eq "platform admin reads every issuance" "$ADMIN" "t" "SELECT count(DISTINCT user_id) > 1 FROM public.unit_issuances;"

# --------------------------------------- (m) legacy state cleanup ---
section "(m) legacy tampered state is closed and put on hold, not legitimized"
MAL=$(newuser mallory@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$MAL','trader');
    INSERT INTO public.portfolios (user_id, cash_balance) VALUES ('$MAL', 1000000000);
    INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price) VALUES ('$MAL','TSTP','brand',1000000,1);" >/dev/null
M1=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty, created_at) VALUES ('$MAL','TSTP','sell','limit',10,100,'open',0,'2000-01-01') RETURNING id;" | head -1)
M2=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$MAL','TSTP','buy','limit',100,1000,'open',0) RETURNING id;" | head -1)
M3=$(su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$MAL','TSTP','sell','limit',0.0004,100,'open',0) RETURNING id;" | head -1)
# Investors of the pre-engine app (before 2026-08-12): orders filled at once
# at their own price, no trade row, cash written straight to the balance.
legacy_fill() { su "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_price, filled_at) VALUES ('$1','TSTP','$2','limit',$3,$4,'filled',$4,now()-interval '60 days');" >/dev/null; }
WIN=$(newuser winner@test.local); LOSS=$(newuser loser@test.local); FAB=$(newuser fabricator@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$WIN','trader'), ('$LOSS','trader'), ('$FAB','trader');
    INSERT INTO public.portfolios (user_id, cash_balance, created_at) VALUES
      ('$WIN', 100050, now()-interval '60 days'),     -- bought 10 @ 100, sold 10 @ 105
      ('$LOSS', 100000, now()-interval '60 days'),    -- bought 10 @ 100, sold 10 @ 90, then self-set back
      ('$FAB', 5100000, now()-interval '60 days');    -- self-set, 'explained' by a sale of units never held" >/dev/null
legacy_fill "$WIN" buy 10 100; legacy_fill "$WIN" sell 10 105
legacy_fill "$LOSS" buy 10 100; legacy_fill "$LOSS" sell 10 90
legacy_fill "$FAB" sell 50000 100
# Fabricated filled rows the old app could never write (negative or NaN
# price/qty) explain nothing: self-set cash and minted units stay on hold.
NEGP=$(newuser negprice@test.local); NEGQ=$(newuser negqty@test.local); NANQ=$(newuser nanqty@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$NEGP','trader'), ('$NEGQ','trader'), ('$NANQ','trader');
    INSERT INTO public.portfolios (user_id, cash_balance, created_at) VALUES
      ('$NEGP', 1000100000, now()-interval '60 days'),  -- 'bought' 1000 @ -1,000,000
      ('$NEGQ', 99999.90, now()-interval '60 days'),    -- 'sold' -1000 @ 0.0001: +1000 units
      ('$NANQ', 1000000000, now()-interval '60 days');  -- 'bought' NaN units
    INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price) VALUES
      ('$NEGP','TSTP','brand',1000,1), ('$NEGQ','TSTP','brand',1000,1), ('$NANQ','TSTP','brand',1000000,1);" >/dev/null
legacy_fill "$NEGP" buy 1000 -1000000; legacy_fill "$NEGQ" sell -1000 0.0001; legacy_fill "$NANQ" buy "'NaN'" 1
OPEN_BEFORE=$(su "SELECT count(*) FROM public.orders WHERE status IN ('open','partial');")
CASH_BEFORE=$(total_cash)
for mig in cash_opening_balance legacy_state_cleanup; do
  f=$(ls "$REPO"/supabase/migrations/*_"$mig".sql 2>/dev/null | head -1)
  if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "$mig migration applies to the legacy state"
  else bad "$mig migration applies to the legacy state" "${f:-*_$mig.sql not found} ${out:-}"; fi
done
su_eq "every legacy resting order closed with a legacy_close audit row" "0|$OPEN_BEFORE" "SELECT (SELECT count(*) FROM public.orders WHERE status IN ('open','partial')) || '|' || (SELECT count(*) FROM public.orders_audit WHERE action='legacy_close');"
su_eq "tampered orders (backdated, 10x bid, fractional) closed" "cancelled|cancelled|cancelled" "SELECT (SELECT status FROM public.orders WHERE id='$M1') || '|' || (SELECT status FROM public.orders WHERE id='$M2') || '|' || (SELECT status FROM public.orders WHERE id='$M3');"
su_eq "self-set cash and minted units put on hold" "unexplained_cash,unexplained_units" "SELECT string_agg(reason, ',' ORDER BY reason) FROM public.launch_review_holds WHERE user_id='$MAL';"
su_eq "held account lost the trader role" "false|true" "SELECT public.has_role('$MAL','trader') || '|' || bool_and(had_trader_role) FROM public.launch_review_holds WHERE user_id='$MAL';"
su_eq "out-of-ledger legacy balance above the old default held" "unexplained_cash" "SELECT string_agg(reason, ',') FROM public.launch_review_holds WHERE user_id='$LEG3';"
su_eq "legit accounts are not held" "0" "SELECT count(*) FROM public.launch_review_holds WHERE user_id IN ('$ALICE','$BOB','$DAVE','$FRANK','$GUS','$LEG1','$LEG2');"
su_eq "a realized gain from pre-engine fills is explained: not held, still a trader" "0|true" "SELECT (SELECT count(*) FROM public.launch_review_holds WHERE user_id='$WIN') || '|' || public.has_role('$WIN','trader');"
su_eq "a pre-engine loss hidden by self-set cash is held" "unexplained_cash|99900.00|false" "SELECT reason || '|' || (detail->>'explained_amount') || '|' || public.has_role('$LOSS','trader') FROM public.launch_review_holds WHERE user_id='$LOSS';"
su_eq "a fabricated sale of units never held explains no cash" "unexplained_cash|false" "SELECT string_agg(reason, ',') || '|' || public.has_role('$FAB','trader') FROM public.launch_review_holds WHERE user_id='$FAB';"
su_eq "a fabricated negative-price buy explains neither cash nor units" "unexplained_cash,unexplained_units|false" "SELECT string_agg(reason, ',' ORDER BY reason) || '|' || public.has_role('$NEGP','trader') FROM public.launch_review_holds WHERE user_id='$NEGP';"
su_eq "a fabricated negative-qty sale explains no units" "unexplained_units|false" "SELECT string_agg(reason, ',' ORDER BY reason) || '|' || public.has_role('$NEGQ','trader') FROM public.launch_review_holds WHERE user_id='$NEGQ';"
su_eq "a fabricated NaN quantity explains nothing" "unexplained_cash,unexplained_units|false" "SELECT string_agg(reason, ',' ORDER BY reason) || '|' || public.has_role('$NANQ','trader') FROM public.launch_review_holds WHERE user_id='$NANQ';"
check "no balance changed by the cleanup" "$(total_cash)" "$CASH_BEFORE"
expect_err "held account cannot trade" service "FORBIDDEN_TRADER_REQUIRED" "SELECT * FROM public.match_order('$MAL','TSTP','brand','sell','limit',1,100);"
expect_err "holds are not readable by users" "$MAL" "permission denied" "SELECT * FROM public.launch_review_holds;"
su_eq "Bob's resting ask was legacy-closed" "cancelled|legacy_close" "SELECT status || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$BASK' ORDER BY changed_at DESC LIMIT 1) FROM public.orders WHERE id='$BASK';"
expect_eq "owner restores a legacy-closed order through the full checks" service "open" "SELECT status FROM public.restore_order('$BOB', '$BASK');"
expect_err "a legacy-closed order that breaks today's rules cannot come back" service "INVALID_QTY" "SELECT * FROM public.restore_order('$MAL', '$M3');"
if out=$("${PSQL[@]}" -1 -f "$(ls "$REPO"/supabase/migrations/*_legacy_state_cleanup.sql | head -1)" 2>&1 >/dev/null); then ok "cleanup is re-runnable"; else bad "cleanup is re-runnable" "$out"; fi
su_eq "re-run adds no duplicate hold" "2" "SELECT count(*) FROM public.launch_review_holds WHERE user_id='$MAL';"
# The admin's correction after review (minted units removed) so the global
# unit invariants below stay meaningful.
su "DELETE FROM public.positions WHERE user_id IN ('$MAL','$NEGP','$NEGQ','$NANQ');
    DELETE FROM public.orders WHERE user_id IN ('$NEGP','$NEGQ','$NANQ');" >/dev/null

# ------------------------------------------ (o) public market data API ---
section "(o) public market data API: anon, published instruments only, aggregates only"
RIYADH_DAY="(date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')"
PUBLIC_MARKET_FNS="'public_market_overview','public_market_summary','public_instrument','public_candles','public_recent_trades','public_shariah_rulings','public_company_profile'"
su_eq "seeded demo instruments are not listed after the migrations" "0|true" "SELECT (SELECT count(*) FROM public.brands WHERE published AND (symbol IN ('2222','1120','7010','2010','EMAAR','ADCB','KSA-30') OR symbol ~ '^[A-Z]{3}[0-9]{3}\$')) || '|' || (SELECT count(*) > 250 FROM public.brands WHERE NOT published AND symbol ~ '^[A-Z]{3}[0-9]{3}\$');"
expect_eq "no demo seed in the public market board" anon "0" "SELECT count(*) FROM public.public_market_overview() WHERE symbol IN ('2222','1120','7010','2010','EMAAR','ADCB','KSA-30') OR symbol ~ '^[A-Z]{3}[0-9]{3}\$';"
MKB=$(newuser mkt-buyer@test.local); MKS=$(newuser mkt-seller@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$MKB','trader'), ('$MKS','trader');
    INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, reference_price, published, company_id) VALUES
      ('MKTA','mkt-a','ma','Market A','retail',50,true,'$CO'),
      ('MKTB','mkt-b','mb','Market B',NULL,33.33,true,NULL),
      ('MKTC','mkt-c','mc','Market C',NULL,10,true,NULL),
      ('MKTK','mkt-k','mk','Market K',NULL,10,true,NULL),
      ('MKTX','mkt-x','mx','Market X',NULL,20,true,NULL),
      ('MKTD','mkt-d','md','Market D',NULL,20,true,NULL);" >/dev/null
q service "SELECT public.post_cash_movement('$MKB','deposit',100000,NULL,'seed','$ADMIN');" >/dev/null
for s in MKTA MKTC MKTX MKTD; do q service "SELECT public.issue_units('$ADMIN','$MKS','$s',1000,10,'market data test');" >/dev/null; done
# Two investors trade through match_order: the seller's ask, then the buyer's crossing bid.
mtrade() { mo "$MKS" "$1" sell limit "$2" "$3" >/dev/null; mo "$MKB" "$1" buy limit "$2" "$3" >/dev/null; }
mtrade MKTA 10 50; mtrade MKTA 5 52; mtrade MKTA 20 55; mtrade MKTA 4 51
su_eq "scenario: four MKTA trades between the two investors" "4|$MKB|$MKS" "SELECT count(*) || '|' || min(buyer_id::text) || '|' || min(seller_id::text) FROM public.trades WHERE symbol='MKTA';"
# 50 three days ago, 52 thirty hours ago (the previous close, >= 24h old),
# 55 earlier today (Asia/Riyadh), 51 just now.
su "UPDATE public.trades SET created_at = now() - interval '3 days' WHERE symbol='MKTA' AND price=50;
    UPDATE public.trades SET created_at = now() - interval '30 hours' WHERE symbol='MKTA' AND price=52;
    UPDATE public.trades SET created_at = $RIYADH_DAY + (now() - $RIYADH_DAY) / 2 WHERE symbol='MKTA' AND price=55;" >/dev/null
LASTAT=$(su "SELECT max(created_at) FROM public.trades WHERE symbol='MKTA';")
for fn in "public_market_overview()" "public_market_overview('$CO')" "public_market_summary()" "public_instrument('mkt-a')" "public_candles('MKTA','1d',10)" "public_recent_trades('MKTA',10)" "public_shariah_rulings()" "public_company_profile('$CO')"; do
  label=${fn//$CO/<company>}
  expect_ok "anon can call $label" anon "SELECT count(*) FROM public.$fn;"
  expect_ok "signed-in user can call $label" "$ALICE" "SELECT count(*) FROM public.$fn;"
done
expect_eq "overview: last price, 24h change vs the last trade >= 24h old, volume once per trade" anon "MKTA|51|-1.92|24|1304|2|$LASTAT" \
  "SELECT symbol || '|' || trim_scale(last_price) || '|' || change_24h_pct || '|' || trim_scale(volume_24h_units) || '|' || trim_scale(volume_24h_value) || '|' || trades_24h || '|' || last_trade_at FROM public.public_market_overview() WHERE symbol='MKTA';"
expect_eq "overview: listing data and the company of a published instrument" anon "mkt-a|Market A|retail|brand|50|$CO|Acme" \
  "SELECT slug || '|' || name_en || '|' || sector || '|' || asset_class || '|' || trim_scale(reference_price) || '|' || company_id || '|' || company_name_en FROM public.public_market_overview() WHERE symbol='MKTA';"
expect_eq "overview: no trade yet -> null prices, zero volume, reference price kept" anon "|||0|0|0||33.33" \
  "SELECT coalesce(last_price::text,'') || '|' || coalesce(change_24h_pct::text,'') || '|' || coalesce(last_trade_at::text,'') || '|' || volume_24h_units || '|' || volume_24h_value || '|' || trades_24h || '|' || coalesce(shariah_status,'') || '|' || trim_scale(reference_price) FROM public.public_market_overview() WHERE symbol='MKTB';"
expect_eq "overview agrees with get_symbol_market_stats" "$ALICE" "t" \
  "SELECT (o.last_price, o.change_24h_pct, o.volume_24h_units, o.trades_24h) IS NOT DISTINCT FROM (s.last_price, s.change_24h_pct, s.volume_24h, s.trade_count_24h) FROM public.public_market_overview() o, public.get_symbol_market_stats('MKTA') s WHERE o.symbol='MKTA';"
expect_eq "overview lists every published instrument, only those, by symbol" anon "true|0|true" \
  "SELECT ((SELECT count(*) FROM public.public_market_overview()) = (SELECT listed_count FROM public.public_market_summary())) || '|' || (SELECT count(*) FROM public.public_market_overview() WHERE symbol = 'TSTU') || '|' || (SELECT array_agg(symbol) = array_agg(symbol ORDER BY symbol) FROM public.public_market_overview());"
su_eq "listed count = published instruments" "t" "SELECT (SELECT count(*) FROM public.brands WHERE published) = $(q anon "SELECT listed_count FROM public.public_market_summary();");"
PUB_TRADES=$(su "SELECT count(*) || '|' || coalesce(trim_scale(round(sum(t.qty * t.price), 2)), 0) || '|' || (SELECT max(t2.created_at) FROM public.trades t2 JOIN public.brands b2 ON b2.symbol = t2.symbol AND b2.published) FROM public.trades t JOIN public.brands b ON b.symbol = t.symbol AND b.published WHERE t.created_at > now() - interval '24 hours';")
expect_eq "summary: 24h trades, value and last trade over published instruments" anon "$PUB_TRADES" \
  "SELECT trades_24h || '|' || trim_scale(volume_24h_value) || '|' || last_trade_at FROM public.public_market_summary();"
expect_eq "summary = sum of the board rows" anon "t" \
  "SELECT (s.trades_24h, s.volume_24h_value, s.last_trade_at) = (SELECT sum(trades_24h), sum(volume_24h_value), max(last_trade_at) FROM public.public_market_overview()) FROM public.public_market_summary() s;"
expect_eq "instrument by slug: today's open/high/low and the band anchored on the previous close" anon "MKTA|55|55|51|52|41.60|62.40" \
  "SELECT symbol || '|' || trim_scale(day_open) || '|' || trim_scale(day_high) || '|' || trim_scale(day_low) || '|' || trim_scale(band_reference) || '|' || band_low || '|' || band_high FROM public.public_instrument('mkt-a');"
expect_eq "instrument by symbol, case-insensitive" anon "MKTA|MKTA|MKTA" \
  "SELECT (SELECT symbol FROM public.public_instrument('MKTA')) || '|' || (SELECT symbol FROM public.public_instrument(' mkta ')) || '|' || (SELECT symbol FROM public.public_instrument('Mkt-A'));"
expect_eq "instrument: unknown, unpublished or malformed -> no row" anon "0" \
  "SELECT (SELECT count(*) FROM public.public_instrument('nope')) + (SELECT count(*) FROM public.public_instrument('TSTU')) + (SELECT count(*) FROM public.public_instrument(NULL)) + (SELECT count(*) FROM public.public_instrument(repeat('a', 65)));"
expect_eq "instrument without trades: no day range, band from the reference price" anon "|||33.33|26.67|39.99" \
  "SELECT coalesce(day_open::text,'') || '|' || coalesce(day_high::text,'') || '|' || coalesce(day_low::text,'') || '|' || trim_scale(band_reference) || '|' || band_low || '|' || band_high FROM public.public_instrument('MKTB');"
# The band shown is exactly the range match_order accepts, at both edges.
band_edge() { # band_edge <name> <user> <symbol> <side> <price> <expect: open|PRICE_OUT_OF_BAND>
  local out; out=$(mo "$2" "$3" "$4" limit 1 "$5")
  if [ "$6" = open ] && [ "$(cut -d'|' -f4 <<<"$out")" = open ]; then
    ok "$1"; q service "SELECT * FROM public.cancel_order('$2', '$(cut -d'|' -f1 <<<"$out")');" >/dev/null
  elif [ "$6" != open ] && grep -q "$6" <<<"$out"; then ok "$1"
  else bad "$1" "$out"; fi
}
band_edge "engine accepts a buy at band_high (62.40)" "$MKB" MKTA buy 62.40 open
band_edge "engine refuses a buy one tick above band_high" "$MKB" MKTA buy 62.41 PRICE_OUT_OF_BAND
band_edge "engine accepts a sell at band_low (41.60)" "$MKS" MKTA sell 41.60 open
band_edge "engine refuses a sell one tick below band_low" "$MKS" MKTA sell 41.59 PRICE_OUT_OF_BAND
band_edge "rounded band: engine accepts 39.99 (33.33 * 1.2 = 39.996)" "$MKB" MKTB buy 39.99 open
band_edge "rounded band: engine refuses 40.00" "$MKB" MKTB buy 40.00 PRICE_OUT_OF_BAND
band_edge "rounded band: engine accepts 26.67 (33.33 * 0.8 = 26.664)" "$MKB" MKTB buy 26.67 open
band_edge "rounded band: engine refuses 26.66" "$MKB" MKTB buy 26.66 PRICE_OUT_OF_BAND
expect_eq "recent trades: newest first, price and quantity only" anon "51x4,55x20,52x5,50x10" \
  "SELECT string_agg(trim_scale(price) || 'x' || trim_scale(qty), ',' ORDER BY n) FROM public.public_recent_trades('mkta') WITH ORDINALITY AS r(price, qty, traded_at, n);"
expect_eq "recent trades: limit honoured" anon "51x4,55x20" \
  "SELECT string_agg(trim_scale(price) || 'x' || trim_scale(qty), ',' ORDER BY n) FROM public.public_recent_trades('MKTA', 2) WITH ORDINALITY AS r(price, qty, traded_at, n);"
# Candles on fixed timestamps (Asia/Riyadh = UTC+3): three trades in the
# 09:00 hour, one at 11:15, one at 01:30 the next Riyadh day (still
# 2026-01-10 in UTC).
mtrade MKTC 1 10; mtrade MKTC 2 12; mtrade MKTC 3 9; mtrade MKTC 4 11; mtrade MKTC 5 11.5
su "UPDATE public.trades SET created_at = CASE price WHEN 10 THEN timestamptz '2026-01-10 09:05+03' WHEN 12 THEN timestamptz '2026-01-10 09:40+03'
      WHEN 9 THEN timestamptz '2026-01-10 09:50+03' WHEN 11 THEN timestamptz '2026-01-10 11:15+03' ELSE timestamptz '2026-01-11 01:30+03' END
    WHERE symbol='MKTC';" >/dev/null
CANDLE="to_char(bucket_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') || '|' || trim_scale(open_price) || '|' || trim_scale(high_price) || '|' || trim_scale(low_price) || '|' || trim_scale(close_price) || '|' || trim_scale(volume_units) || '|' || trade_count"
expect_eq "1d candles: Asia/Riyadh days, OHLC by trade time, volume in units" anon "2026-01-09T21:00|10|12|9|11|10|4
2026-01-10T21:00|11.5|11.5|11.5|11.5|5|1" "SELECT $CANDLE FROM public.public_candles('mktc', '1d', 10);"
expect_eq "1h candles: only hours that have trades, oldest first" anon "2026-01-10T06:00|10|12|9|9|6|3
2026-01-10T08:00|11|11|11|11|4|1
2026-01-10T22:00|11.5|11.5|11.5|11.5|5|1" "SELECT $CANDLE FROM public.public_candles('MKTC', '1h', 10);"
expect_eq "candles limit keeps the most recent buckets, still ascending" anon "2026-01-10T08:00|11|11|11|11|4|1
2026-01-10T22:00|11.5|11.5|11.5|11.5|5|1" "SELECT $CANDLE FROM public.public_candles('MKTC', '1h', 2);"
expect_eq "candles: unknown interval or symbol -> nothing" anon "0" \
  "SELECT (SELECT count(*) FROM public.public_candles('MKTC', '5m', 10)) + (SELECT count(*) FROM public.public_candles('NOPE', '1d', 10)) + (SELECT count(*) FROM public.public_candles('TSTU', '1d', 10));"
expect_eq "old trades only: last price kept, 24h change 0, no 24h volume" anon "11.5|0.00|0|0" \
  "SELECT trim_scale(last_price) || '|' || change_24h_pct || '|' || volume_24h_units || '|' || trades_24h FROM public.public_market_overview() WHERE symbol='MKTC';"
# Caps: 600 hourly trades (buyer = seller, units unchanged) and 1000 extra listings.
su "INSERT INTO public.trades (symbol, asset_class, qty, price, buyer_id, seller_id, created_at)
    SELECT 'MKTK', 'brand', 1, 10, '$MKB', '$MKB', now() - interval '40 days' - g * interval '1 hour' FROM generate_series(1, 600) g;" >/dev/null
expect_eq "candles capped at 500 buckets (default 200, minimum 1)" anon "500|200|200|1" \
  "SELECT (SELECT count(*) FROM public.public_candles('MKTK', '1h', 100000)) || '|' || (SELECT count(*) FROM public.public_candles('MKTK', '1h', NULL)) || '|' || (SELECT count(*) FROM public.public_candles('MKTK', '1h')) || '|' || (SELECT count(*) FROM public.public_candles('MKTK', '1h', -5));"
expect_eq "recent trades capped at 50 (default 20, minimum 1)" anon "50|20|1" \
  "SELECT (SELECT count(*) FROM public.public_recent_trades('MKTK', 100000)) || '|' || (SELECT count(*) FROM public.public_recent_trades('MKTK')) || '|' || (SELECT count(*) FROM public.public_recent_trades('MKTK', 0));"
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published)
    SELECT 'CAP' || lpad(g::text, 4, '0'), 'cap' || lpad(g::text, 4, '0'), 'c', 'Cap', 1, true FROM generate_series(1, 1000) g;" >/dev/null
expect_eq "market board capped at 1000 rows; the summary still counts every listing" anon "1000|true" \
  "SELECT (SELECT count(*) FROM public.public_market_overview()) || '|' || ((SELECT listed_count FROM public.public_market_summary()) > 1000);"
su "DELETE FROM public.brands WHERE symbol LIKE 'CAP____';" >/dev/null
# Shariah: the ruling in force, same pick as the engine.
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('MKTA','halal','compliant');" >/dev/null
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('MKTA','reviewing','annual review');" >/dev/null
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('TSTU','halal','unlisted');" >/dev/null
expect_eq "rulings: the ruling in force with its reason" anon "MKTA|mkt-a|reviewing|annual review" \
  "SELECT symbol || '|' || slug || '|' || status || '|' || reason FROM public.public_shariah_rulings() WHERE symbol='MKTA';"
expect_eq "rulings match current_shariah_status for every listed symbol" service "0|true" \
  "SELECT (SELECT count(*) FROM public.public_shariah_rulings() r WHERE r.status IS DISTINCT FROM public.current_shariah_status(r.symbol)) || '|' || ((SELECT count(*) FROM public.public_shariah_rulings()) = (SELECT count(*) FROM public.brands b WHERE b.published AND EXISTS (SELECT 1 FROM public.shariah_decisions d WHERE d.symbol = b.symbol)));"
expect_eq "rulings and board: unpublished instruments excluded, status on the board" anon "0|reviewing" \
  "SELECT (SELECT count(*) FROM public.public_shariah_rulings() WHERE symbol='TSTU') || '|' || (SELECT shariah_status FROM public.public_market_overview() WHERE symbol='MKTA');"
expect_err "anon cannot read who ruled (reviewer_id)" anon "permission denied" "SELECT reviewer_id FROM public.shariah_decisions LIMIT 1;"
expect_err "anon cannot read updated_by either" anon "permission denied" "SELECT updated_by FROM public.shariah_decisions LIMIT 1;"
expect_ok "anon still reads the public ruling columns" anon "SELECT id, symbol, status, reason, created_at, updated_at, effective_at FROM public.shariah_decisions ORDER BY effective_at DESC LIMIT 5;"
# Company profile.
expect_eq "company profile: a company with a published instrument" anon "$CO|Acme" "SELECT id || '|' || name_en FROM public.public_company_profile('$CO');"
expect_eq "company profile: its published instruments" anon "MKTA,NEWB,TSTC" "SELECT string_agg(symbol, ',' ORDER BY symbol) FROM public.public_market_overview('$CO');"
expect_eq "company profile: no published instrument or unknown id -> nothing" anon "0|0" \
  "SELECT (SELECT count(*) FROM public.public_company_profile('$NEWCO')) || '|' || (SELECT count(*) FROM public.public_company_profile(gen_random_uuid()));"
# No user, order, trade, instrument or reviewer ids anywhere.
IDS_OUT=$(q anon "SELECT (to_jsonb(r) - 'company_id')::text FROM public.public_market_overview() r;
  SELECT (to_jsonb(r) - 'company_id')::text FROM public.public_market_overview('$CO') r;
  SELECT to_jsonb(r)::text FROM public.public_market_summary() r;
  SELECT (to_jsonb(r) - 'company_id')::text FROM public.public_instrument('mkt-a') r;
  SELECT to_jsonb(r)::text FROM public.public_candles('MKTA', '1h', 500) r;
  SELECT to_jsonb(r)::text FROM public.public_recent_trades('MKTA', 50) r;
  SELECT to_jsonb(r)::text FROM public.public_shariah_rulings() r;
  SELECT (to_jsonb(r) - 'id')::text FROM public.public_company_profile('$CO') r;")
if grep -q '"MKTA"' <<<"$IDS_OUT" && ! grep -qiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$IDS_OUT"; then
  ok "public results carry no uuid besides the company id"
else bad "public results carry no uuid besides the company id" "$(grep -oiE '"[a-z_]+": "[0-9a-f]{8}-[0-9a-f-]{27}"' <<<"$IDS_OUT" | head -3) $(head -c 300 <<<"$IDS_OUT")"; fi
expect_eq "the only uuids returned are ids of companies" service "0" \
  "SELECT count(*) FROM public.public_market_overview() r WHERE r.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = r.company_id);"
su_eq "result columns: no id except the company's" "public_company_profile:id,public_instrument:company_id,public_market_overview:company_id" \
  "SELECT string_agg(p.proname || ':' || a.name, ',' ORDER BY p.proname, a.name) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(name, mode)
    WHERE n.nspname = 'public' AND p.proname IN ($PUBLIC_MARKET_FNS) AND a.mode = 't' AND a.name ~ '(^id\$|_id\$)';"
su_eq "public functions are SECURITY DEFINER, STABLE and pin search_path" "7|7|7" \
  "SELECT count(*) FILTER (WHERE p.prosecdef) || '|' || count(*) FILTER (WHERE p.provolatile = 's') || '|' || count(*) FILTER (WHERE 'search_path=public' = ANY(p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ($PUBLIC_MARKET_FNS);"

section "(o) listing control: set_instrument_published (service role, platform admins)"
mtrade MKTX 5 20
XBID=$(mo_id "$MKB" MKTX buy limit 2 19)
XASK=$(mo_id "$MKS" MKTX sell limit 3 21)
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('MKTX','halal');" >/dev/null
LISTED0=$(q anon "SELECT listed_count FROM public.public_market_summary();")
POS0=$(su "SELECT md5(string_agg(user_id || symbol || qty || '/' || coalesce(avg_price::text, ''), ',' ORDER BY user_id, symbol)) FROM public.positions;")
CASH0=$(total_cash); LEDGER0=$(su "SELECT count(*) FROM public.cash_ledger;"); TRADES0=$(su "SELECT count(*) FROM public.trades;")
expect_err "non-admin actor refused" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT * FROM public.set_instrument_published('MKTX', false, '$BOB');"
expect_err "unknown instrument" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.set_instrument_published('NOPE', false, '$ADMIN');"
expect_err "malformed symbol" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.set_instrument_published('a b', false, '$ADMIN');"
expect_err "published flag required" service "INVALID_INPUT" "SELECT * FROM public.set_instrument_published('MKTX', NULL, '$ADMIN');"
expect_eq "unpublish closes the instrument's resting orders" service "MKTX|false|true|2" \
  "SELECT symbol || '|' || published || '|' || changed || '|' || cancelled_orders FROM public.set_instrument_published('mktx', false, '$ADMIN');"
su_eq "closed orders audited as delisted by the admin" "cancelled|delisted|$ADMIN|cancelled|delisted|$ADMIN" \
  "SELECT (SELECT status FROM public.orders WHERE id='$XBID') || '|' || (SELECT action || '|' || changed_by FROM public.orders_audit WHERE order_id='$XBID') || '|' || (SELECT status FROM public.orders WHERE id='$XASK') || '|' || (SELECT action || '|' || changed_by FROM public.orders_audit WHERE order_id='$XASK');"
check "unpublish leaves positions untouched" "$(su "SELECT md5(string_agg(user_id || symbol || qty || '/' || coalesce(avg_price::text, ''), ',' ORDER BY user_id, symbol)) FROM public.positions;")" "$POS0"
check "unpublish leaves cash, the ledger and trades untouched" "$(total_cash)|$(su "SELECT count(*) FROM public.cash_ledger;")|$(su "SELECT count(*) FROM public.trades;")" "$CASH0|$LEDGER0|$TRADES0"
expect_eq "unpublished instrument disappears from every public result" anon "0|0|0|0|0|0|0|0" \
  "SELECT (SELECT count(*) FROM public.public_market_overview() WHERE symbol='MKTX') || '|' || (SELECT count(*) FROM public.public_instrument('mkt-x')) || '|' || (SELECT count(*) FROM public.public_candles('MKTX', '1d', 10)) || '|' || (SELECT count(*) FROM public.public_recent_trades('MKTX', 10)) || '|' || (SELECT count(*) FROM public.public_shariah_rulings() WHERE symbol='MKTX') || '|' || (SELECT count(*) FROM public.get_order_book('MKTX', 10)) || '|' || (SELECT count(*) FROM public.get_symbol_last_trade('MKTX')) || '|' || (SELECT count(*) FROM public.public_market_summary() WHERE listed_count <> $LISTED0 - 1);"
expect_err "no new order on an unpublished instrument" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.match_order('$MKB','MKTX','brand','buy','limit',1,20);"
expect_err "a resting order cannot be written for an unpublished instrument at all" service "INSTRUMENT_NOT_FOUND" \
  "INSERT INTO public.orders (user_id, symbol, side, type, qty, price, status, filled_qty) VALUES ('$MKB','MKTX','buy','limit',1,20,'open',0);"
expect_eq "unpublish again is a no-op" service "false|0" "SELECT changed || '|' || cancelled_orders FROM public.set_instrument_published('MKTX', false, '$ADMIN');"
expect_eq "republish" service "MKTX|true|true|0" "SELECT symbol || '|' || published || '|' || changed || '|' || cancelled_orders FROM public.set_instrument_published('MKTX', true, '$ADMIN');"
expect_eq "republished instrument is back on the board with its history" anon "MKTX|20" "SELECT symbol || '|' || trim_scale(last_price) FROM public.public_market_overview() WHERE symbol='MKTX';"
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('MKTZ','mkt-z','mz','Market Z',0,false);" >/dev/null
expect_err "publishing needs a positive reference price" service "INVALID_PRICE" "SELECT * FROM public.set_instrument_published('MKTZ', true, '$ADMIN');"
expect_err "a published instrument always has a usable reference price (constraint)" service "brands_published_reference_price" "UPDATE public.brands SET published = true WHERE symbol='MKTZ';"
expect_err "published reference price cannot be set to 0" service "brands_published_reference_price" "UPDATE public.brands SET reference_price = 0 WHERE symbol='MKTA';"
for mig in public_market_data instrument_publish_control; do
  f=$(ls "$REPO"/supabase/migrations/*_"$mig".sql 2>/dev/null | head -1)
  if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "$mig migration re-applies cleanly"
  else bad "$mig migration re-applies cleanly" "${f:-*_$mig.sql not found} ${out:-}"; fi
done
expect_eq "grants survive a re-apply" anon "MKTA" "SELECT symbol FROM public.public_instrument('mkt-a');"

section "(o) delisting the demo instruments (migration)"
# MKTD: no company, no submission (a demo seed). MKTA belongs to a company,
# NEWB came from a submission: both stay listed.
DBID=$(mo_id "$MKB" MKTD buy limit 2 19)
DASK=$(mo_id "$MKS" MKTD sell limit 3 21)
ABID=$(mo_id "$MKB" MKTA buy limit 1 50)
POS0=$(su "SELECT md5(string_agg(user_id || symbol || qty || '/' || coalesce(avg_price::text, ''), ',' ORDER BY user_id, symbol)) FROM public.positions;")
CASH0=$(total_cash); LEDGER0=$(su "SELECT count(*) FROM public.cash_ledger;"); TRADES0=$(su "SELECT count(*) FROM public.trades;")
DEMO_OPEN=$(su "SELECT count(*) FROM public.orders o JOIN public.brands b ON b.symbol = o.symbol WHERE b.company_id IS NULL AND b.source_submission_id IS NULL AND o.status IN ('open','partial');")
DELISTED0=$(su "SELECT count(*) FROM public.orders_audit WHERE action='delisted';")
DELIST=$(ls "$REPO"/supabase/migrations/*_delist_demo_instruments.sql 2>/dev/null | head -1)
if [ -n "$DELIST" ] && out=$("${PSQL[@]}" -1 -f "$DELIST" 2>&1 >/dev/null); then ok "delist migration applies to a live market"
else bad "delist migration applies to a live market" "${DELIST:-*_delist_demo_instruments.sql not found} ${out:-}"; fi
su_eq "every brand without company or submission is unpublished" "0|false" \
  "SELECT (SELECT count(*) FROM public.brands WHERE published AND company_id IS NULL AND source_submission_id IS NULL) || '|' || (SELECT published FROM public.brands WHERE symbol='MKTD');"
su_eq "company and submission instruments stay listed" "true|true|true" \
  "SELECT string_agg(published::text, '|' ORDER BY symbol) FROM public.brands WHERE symbol IN ('MKTA','NEWB','TSTC');"
su_eq "their resting orders closed with a 'delisted' audit row" "cancelled|delisted|cancelled|delisted" \
  "SELECT (SELECT status FROM public.orders WHERE id='$DBID') || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$DBID' ORDER BY changed_at DESC LIMIT 1) || '|' || (SELECT status FROM public.orders WHERE id='$DASK') || '|' || (SELECT action FROM public.orders_audit WHERE order_id='$DASK' ORDER BY changed_at DESC LIMIT 1);"
su_eq "one audit row per closed order" "$((DELISTED0 + DEMO_OPEN))" "SELECT count(*) FROM public.orders_audit WHERE action='delisted';"
su_eq "a listed company's resting order is untouched" "open" "SELECT status FROM public.orders WHERE id='$ABID';"
su_eq "no resting order left on an unpublished instrument" "0" \
  "SELECT count(*) FROM public.orders o WHERE o.status IN ('open','partial') AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published);"
check "delisting leaves positions untouched" "$(su "SELECT md5(string_agg(user_id || symbol || qty || '/' || coalesce(avg_price::text, ''), ',' ORDER BY user_id, symbol)) FROM public.positions;")" "$POS0"
check "delisting leaves cash, the ledger and trades untouched" "$(total_cash)|$(su "SELECT count(*) FROM public.cash_ledger;")|$(su "SELECT count(*) FROM public.trades;")" "$CASH0|$LEDGER0|$TRADES0"
if out=$("${PSQL[@]}" -1 -f "$DELIST" 2>&1 >/dev/null); then ok "delist migration is re-runnable"; else bad "delist migration is re-runnable" "$out"; fi
su_eq "re-run closes nothing new" "$((DELISTED0 + DEMO_OPEN))" "SELECT count(*) FROM public.orders_audit WHERE action='delisted';"
expect_eq "a platform admin can republish a delisted instrument" service "MKTD|true" "SELECT symbol || '|' || published FROM public.set_instrument_published('MKTD', true, '$ADMIN');"
q service "SELECT * FROM public.cancel_order('$MKB', '$ABID');" >/dev/null

# ------------------------------------------------ global invariants (d, f) ---
section "(d)(f) global invariants after every scenario above"
su_eq "cash: every trade debit has an equal credit" "0" "SELECT coalesce(trim_scale(sum(amount)), 0) FROM public.cash_ledger WHERE kind IN ('order_buy','order_sell');"
su_eq "cash: total balances = total deposits/withdrawals/adjustments" "t" "SELECT (SELECT sum(cash_balance) FROM public.portfolios) = (SELECT sum(amount) FROM public.cash_ledger WHERE kind IN ('deposit','withdrawal','adjustment'));"
su_eq "cash: every ledger sums to its balance" "0" "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance <> (SELECT coalesce(sum(amount),0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);"
su_eq "cash: no negative balance" "0" "SELECT count(*) FROM public.portfolios WHERE cash_balance < 0;"
su_eq "units: positions = issued + bought - sold, for every holder" "0" "
  WITH moves AS (
    SELECT user_id, symbol, qty FROM public.unit_issuances
    UNION ALL SELECT buyer_id, symbol, qty FROM public.trades
    UNION ALL SELECT seller_id, symbol, -qty FROM public.trades
  ), expected AS (SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2)
  SELECT count(*) FROM expected e FULL JOIN public.positions p USING (user_id, symbol)
  WHERE coalesce(e.qty, 0) <> coalesce(p.qty, 0);"
su_eq "units: total units per symbol = units issued (trading only moves them)" "0" "
  SELECT count(*) FROM (SELECT symbol, sum(qty) q FROM public.unit_issuances GROUP BY 1) f
  FULL JOIN (SELECT symbol, sum(qty) q FROM public.positions GROUP BY 1) p USING (symbol)
  WHERE coalesce(f.q, 0) <> coalesce(p.q, 0);"
su_eq "units: no negative position" "0" "SELECT count(*) FROM public.positions WHERE qty < 0;"
su_eq "orders: filled_qty never exceeds qty" "0" "SELECT count(*) FROM public.orders WHERE filled_qty > qty;"
su_eq "orders: trades never exceed their orders" "0" "SELECT count(*) FROM public.orders o WHERE o.filled_qty < (SELECT coalesce(sum(qty),0) FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id);"

echo
echo "passed: $PASS  failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then printf '  FAILED: %s\n' "${FAILED[@]}"; exit 1; fi
echo "ALL DATABASE SECURITY CHECKS PASSED"
