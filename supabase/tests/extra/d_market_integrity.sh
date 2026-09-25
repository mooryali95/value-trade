# shellcheck shell=bash
# Data integrity report and public candles (phase 3, agent D). Sourced by
# supabase/tests/security.sh after d_lifecycle.sh (users, and the re-applied
# phase 3 data migrations), before the global invariants.
#
#   I1  integrity_report(): every named check, service role only, read-only;
#       each check turns red on a crafted violation (inside a rolled-back
#       transaction, triggers off)
#   C1  public_candles(): same results as a naive GROUP BY for '1h' and '1d'
#       (Asia/Riyadh days, ties on time), bounded windows, jit off, only
#       published instruments

section "D I1 integrity report"
I_KEYS="cash_matches_ledger,cost_basis_not_negative,no_negative_cash,no_negative_positions,no_resting_on_unpublished,orders_fill_within_qty,published_ready,trade_cash_balanced,trades_reference_orders,units_conserved_per_symbol,units_match_history"
expect_eq "the report lists every named check" service "$I_KEYS" "SELECT string_agg(check_key, ',' ORDER BY check_key) FROM public.integrity_report();"
expect_err "anon cannot run the report" anon "permission denied" "SELECT * FROM public.integrity_report();"
expect_err "signed-in users (admins included) cannot run it directly" "$ADMIN" "permission denied" "SELECT * FROM public.integrity_report();"
# The money / unit checks agree with the suite's own global invariants.
expect_eq "ledger and unit checks pass on the suite's state" service "true|true|true|true|true|true|true|true" \
  "SELECT string_agg(ok::text, '|' ORDER BY check_key) FROM public.integrity_report() WHERE check_key IN ('cash_matches_ledger','trade_cash_balanced','no_negative_cash','units_match_history','units_conserved_per_symbol','no_negative_positions','orders_fill_within_qty','cost_basis_not_negative');"
# Crafted violations, one per check, in a transaction that is rolled back.
I_U=$(su "SELECT user_id FROM public.portfolios WHERE cash_balance > 0 ORDER BY user_id LIMIT 1;")
I_SYM=$(su "SELECT symbol FROM public.positions WHERE qty > 0 ORDER BY symbol, user_id LIMIT 1;")
I_OUT=$("${PSQL[@]}" 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
-- cost_basis >= 0 is also a constraint (20260926100500); drop it for the crafted row.
ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_cost_basis_nonnegative;
UPDATE public.portfolios SET cash_balance = cash_balance + 1 WHERE user_id = '$I_U';
INSERT INTO public.portfolios (user_id, cash_balance) VALUES ('$D_OUT', -5) ON CONFLICT (user_id) DO UPDATE SET cash_balance = -5;
INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after) VALUES ('$I_U', 'order_buy', -3, 0);
UPDATE public.positions SET qty = qty + 1 WHERE (user_id, symbol) = (SELECT user_id, symbol FROM public.positions WHERE symbol = '$I_SYM' AND qty > 0 ORDER BY user_id LIMIT 1);
INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price, cost_basis) VALUES ('$D_OUT', 'DUNP', 'brand', -2, 1, -1);
INSERT INTO public.orders (id, user_id, symbol, side, type, qty, price, status, filled_qty)
  VALUES ('00000000-0000-4000-8000-00000000d001', '$D_OUT', 'DUNP', 'buy', 'limit', 1, 1, 'open', 2);
INSERT INTO public.trades (symbol, qty, price, buyer_id, seller_id, buy_order_id) VALUES ('DUNP', 1, 1, '$D_OUT', '$D_OUT', NULL);
INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('DNORUL', 'dnorul', 'x', 'No ruling', 5, true);
SET LOCAL ROLE service_role;
SELECT string_agg(check_key || '=' || ok || ':' || (violations > 0) || ':' || (jsonb_array_length(sample) BETWEEN 1 AND 5), ',' ORDER BY check_key) FROM public.integrity_report();
ROLLBACK;
SQL
)
check "every check turns red on its violation, with a sample" "$(grep -v '^\(BEGIN\|SET\|UPDATE\|INSERT\|ROLLBACK\)' <<<"$I_OUT" | tail -1)" \
  "cash_matches_ledger=false:true:true,cost_basis_not_negative=false:true:true,no_negative_cash=false:true:true,no_negative_positions=false:true:true,no_resting_on_unpublished=false:true:true,orders_fill_within_qty=false:true:true,published_ready=false:true:true,trade_cash_balanced=false:true:true,trades_reference_orders=false:true:true,units_conserved_per_symbol=false:true:true,units_match_history=false:true:true"
check "the crafted violations were rolled back" "$(su "SELECT count(*) FROM public.brands WHERE symbol='DNORUL';")|$(su "SELECT count(*) FROM public.orders WHERE id='00000000-0000-4000-8000-00000000d001';")|$(su "SELECT count(*) FROM pg_constraint WHERE conname='positions_cost_basis_nonnegative';")" "0|0|1"
check "the report is read-only and time-bounded" "$(su "SELECT provolatile::text || '|' || (proconfig @> ARRAY['statement_timeout=20s']) || '|' || (proconfig @> ARRAY['jit=off']) FROM pg_proc WHERE oid = 'public.integrity_report()'::regprocedure;")" "s|true|true"

section "D C1 public candles"
# DCND: published, ruled on; trades inserted directly (candles read only
# symbol / time / price / qty), removed again at the end so the ledger
# invariants are untouched.
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('DCND','dcnd','ش','Candles',10,false);" >/dev/null
q "$D_REV" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('DCND','halal','Test instrument');" >/dev/null
q service "SELECT 1 FROM public.set_instrument_published('DCND', true, '$ADMIN');" >/dev/null
su "SET session_replication_role = replica;
    -- 60 Riyadh days, several hours a day, a few trades an hour; prices vary.
    INSERT INTO public.trades (symbol, qty, price, buyer_id, seller_id, created_at)
    SELECT 'DCND', 1 + (g % 7), 10 + ((g * 37) % 200) / 100.0, '$D_OUT', '$D_OUT',
           timestamptz '2026-07-01 00:00:00+03' + (g / 5) * interval '37 minutes' + (g % 5) * interval '11 seconds'
      FROM generate_series(0, 11999) g;
    -- Ties: three trades at the same instant (open / close tie-break on id).
    INSERT INTO public.trades (id, symbol, qty, price, buyer_id, seller_id, created_at) VALUES
      ('00000000-0000-4000-8000-0000000000a1', 'DCND', 1, 11.11, '$D_OUT', '$D_OUT', '2026-09-20 23:59:59.5+03'),
      ('00000000-0000-4000-8000-0000000000a2', 'DCND', 1, 12.22, '$D_OUT', '$D_OUT', '2026-09-20 23:59:59.5+03'),
      ('00000000-0000-4000-8000-0000000000a0', 'DCND', 1, 13.33, '$D_OUT', '$D_OUT', '2026-09-20 00:00:00+03'),
      ('00000000-0000-4000-8000-0000000000a3', 'DCND', 1, 14.44, '$D_OUT', '$D_OUT', '2026-09-20 00:00:00+03');
    SET session_replication_role = origin;" >/dev/null
# The naive reference: GROUP BY bucket, open/close by (time, id).
cnd_naive() { # cnd_naive <interval> <limit>
  local trunc="date_trunc('day', created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'" cap=366
  [ "$1" == "1h" ] && trunc="date_trunc('hour', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'" && cap=500
  echo "SELECT md5(coalesce(string_agg(concat_ws(':', b, o, h, l, c, v, n), ',' ORDER BY b), '')) || ':' || count(*) FROM (
          SELECT $trunc AS b, (array_agg(price ORDER BY created_at, id))[1] AS o, max(price) AS h, min(price) AS l,
                 (array_agg(price ORDER BY created_at DESC, id DESC))[1] AS c, sum(qty) AS v, count(*) AS n
            FROM public.trades WHERE symbol='DCND' GROUP BY 1 ORDER BY 1 DESC LIMIT LEAST(GREATEST($2, 1), $cap)) x;"
}
cnd_fn() {
  echo "SELECT md5(coalesce(string_agg(concat_ws(':', bucket_start, open_price, high_price, low_price, close_price, volume_units, trade_count), ',' ORDER BY bucket_start), '')) || ':' || count(*)
          FROM public.public_candles('DCND', '$1', $2);"
}
for c_case in "1h 1" "1h 24" "1h 500" "1h 5000" "1d 1" "1d 30" "1d 200" "1d 1000" "1d 0" "1h -5"; do
  read -r c_int c_lim <<<"$c_case"
  check "candles $c_int limit $c_lim = naive GROUP BY" "$(q anon "$(cnd_fn "$c_int" "$c_lim")")" "$(su "$(cnd_naive "$c_int" "$c_lim")")"
done
C_DAYS=$(su "SELECT count(DISTINCT date_trunc('day', created_at AT TIME ZONE 'Asia/Riyadh')) FROM public.trades WHERE symbol='DCND';")
C_HOURS=$(su "SELECT count(DISTINCT date_trunc('hour', created_at)) FROM public.trades WHERE symbol='DCND';")
check "fixture spans many days and more than 500 hours" "$([ "$C_DAYS" -gt 30 ] && [ "$C_HOURS" -gt 500 ] && echo yes)" "yes"
check "'1d' is capped at 366 buckets, '1h' at 500" "$(q anon "SELECT count(*) FROM public.public_candles('DCND','1d',100000);")|$(q anon "SELECT count(*) FROM public.public_candles('DCND','1h',100000);")" "$(( C_DAYS < 366 ? C_DAYS : 366 ))|500"
expect_eq "ties on time: open = first by id, close = last by id (Riyadh day)" anon "13.33|12.22" \
  "SELECT trim_scale(open_price) || '|' || trim_scale(close_price) FROM public.public_candles('DCND','1d',200) WHERE bucket_start = timestamptz '2026-09-20 00:00:00+03';"
expect_eq "symbol is case- and space-insensitive" anon "1" "SELECT count(*) FROM public.public_candles('  dcnd ','1d',1);"
expect_eq "an unknown interval returns nothing" anon "0" "SELECT count(*) FROM public.public_candles('DCND','5m',10);"
expect_eq "an unpublished instrument returns nothing" anon "0" "SELECT count(*) FROM public.public_candles('TSTU','1d',10);"
check "public_candles runs with jit off and a pinned search_path" "$(su "SELECT (proconfig @> ARRAY['jit=off']) || '|' || (proconfig @> ARRAY['search_path=public']) FROM pg_proc WHERE oid = 'public.public_candles(text, text, integer)'::regprocedure;")" "true|true"
check "covering index on trades (symbol, created_at, id) INCLUDE (price, qty)" "$(su "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='trades' AND indexname='idx_trades_symbol_time_cover';")" "1"
check "anon and signed-in users may read candles (market data)" "$(su "SELECT has_function_privilege('anon', 'public.public_candles(text, text, integer)', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.public_candles(text, text, integer)', 'EXECUTE');")" "true|true"
# Clean up: the direct trades carry no orders, ledger rows or positions.
su "SET session_replication_role = replica; DELETE FROM public.trades WHERE symbol='DCND'; SET session_replication_role = origin;" >/dev/null
check "candle fixtures removed" "$(su "SELECT count(*) FROM public.trades WHERE symbol='DCND';")" "0"
