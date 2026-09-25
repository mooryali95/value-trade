# shellcheck shell=bash
# Money correctness (phase 3, agent M). Sourced by supabase/tests/security.sh
# before the global invariants, with its helpers in scope. Every expected
# value below is computed by hand (exact decimals) in the comments.
#
#   M1  exact cost basis (positions.cost_basis) and derived avg_price
#   M2  pro-rata cost removal in cents: a closed position's cost equals the
#       cash paid, so realized = cash P/L to the cent
#   M3  buying_power() / open_buy_reserve(); market buys reserved at the
#       band top ON THE TICK (_high_tick), size check likewise
#   M4  withdrawals cannot consume cash reserved by resting buys; the sign
#       of every cash movement is enforced per kind
#   L1  a resting order's average fill price from its exact fill amounts
#   ref reference price rules (tick, >= 0.05, <= 1,000,000,000)
#   H1  portfolio_positions(): last trade, else band reference, never cost

section "M money: setup"
# The suite above re-applies older migrations on purpose (e.g.
# *_cash_opening_balance.sql redefines post_cash_movement). Re-apply the
# phase 3 money migrations first: this checks that they are re-runnable on a
# live, drifted database and restores their definitions for the checks below.
for mig in exact_cost_basis engine_money_fixes reference_price_rules portfolio_valuation money_execute_allowlist; do
  f=$(ls "$REPO"/supabase/migrations/*_"$mig".sql 2>/dev/null | head -1)
  if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "$mig migration re-applies on the suite's live state"
  else bad "$mig migration re-applies on the suite's live state" "${f:-*_$mig.sql not found} ${out:-}"; fi
done
M_S=$(newuser m_seller@test.local); M_B=$(newuser m_buyer@test.local); M_C=$(newuser m_cbuyer@test.local)
M_P=$(newuser m_pcents@test.local); M_R=$(newuser m_rbuyer@test.local); M_T=$(newuser m_thirds@test.local)
M_F=$(newuser m_fprice@test.local); M_G=$(newuser m_gpower@test.local); M_H=$(newuser m_hmarket@test.local)
M_K=$(newuser m_ktick@test.local); M_K2=$(newuser m_ktick2@test.local); M_W=$(newuser m_wdraw@test.local)
M_N=$(newuser m_nobody@test.local); M_X=$(newuser m_legacy@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES
  ('$M_S','trader'),('$M_B','trader'),('$M_C','trader'),('$M_P','trader'),('$M_R','trader'),('$M_T','trader'),
  ('$M_F','trader'),('$M_G','trader'),('$M_H','trader'),('$M_K','trader'),('$M_K2','trader'),('$M_W','trader');" >/dev/null
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES
  ('MMCB','mmcb','m','Money CB',10,true), ('MMRT','mmrt','m','Money RT',1,true), ('MMTH','mmth','m','Money TH',10,true),
  ('MMFP','mmfp','m','Money FP',10,true), ('MMBP','mmbp','m','Money BP',50,true), ('MMMK','mmmk','m','Money MK',50,true),
  ('MMTK','mmtk','m','Money TK',10.01,true), ('MMNT','mmnt','m','Money NT',20,true), ('MMRF','mmrf','m','Money RF',0,false);" >/dev/null
q service "SELECT public.issue_units('$ADMIN','$M_S','MMCB',300000,9,'m'), public.issue_units('$ADMIN','$M_S','MMRT',10,0.9,'m'),
  public.issue_units('$ADMIN','$M_S','MMTH',10,9,'m'), public.issue_units('$ADMIN','$M_S','MMFP',10,9,'m'),
  public.issue_units('$ADMIN','$M_S','MMBP',100,45,'m'), public.issue_units('$ADMIN','$M_S','MMMK',20,45,'m'),
  public.issue_units('$ADMIN','$M_S','MMTK',1000,9,'m'), public.issue_units('$ADMIN','$M_C','MMNT',5,18,'m');" >/dev/null
for u in $M_B $M_C; do q service "SELECT public.post_cash_movement('$u','deposit',3100000,NULL,'m','$ADMIN');" >/dev/null; done
for u in $M_P $M_R $M_T $M_F; do q service "SELECT public.post_cash_movement('$u','deposit',100,NULL,'m','$ADMIN');" >/dev/null; done
mpos() { su "SELECT coalesce((SELECT trim_scale(qty) || '|' || cost_basis || '|' || avg_price FROM public.positions WHERE user_id='$1' AND symbol='$2'), 'none');"; }
mstat() { cut -d'|' -f2- <<<"$1"; }
check "issuance sets the cost basis at the issue price (300,000 x 9 = 2,700,000.00)" "$(mpos "$M_S" MMCB)" "300000|2700000.00|9.0000"

section "M1 exact cost basis at scale (formula audit M1 repro)"
mo "$M_S" MMCB sell limit 100000 10.01 >/dev/null
check "buy 100,000 @ 10.01 fills" "$(mstat "$(mo "$M_B" MMCB buy limit 100000 10.01)")" "100000|10.0100|filled"
# Seller: 2,700,000.00 - round(2,700,000.00 x 100,000 / 300,000) = 1,800,000.00
check "seller cost after selling 1/3: pro rata 900,000.00 removed" "$(mpos "$M_S" MMCB)" "200000|1800000.00|9.0000"
mo "$M_S" MMCB sell limit 200000 10.00 >/dev/null
check "buy 200,000 @ 10.00 fills" "$(mstat "$(mo "$M_B" MMCB buy limit 200000 10.00)")" "200000|10.0000|filled"
check "seller fully closed: row deleted" "$(mpos "$M_S" MMCB)" "none"
# 1,001,000.00 + 2,000,000.00 = 3,001,000.00; avg 10.00333 -> 10.0033 (qty x avg would say 3,000,990.00)
check "buyer cost basis = cash paid 3,001,000.00 (avg 10.0033 display only)" "$(mpos "$M_B" MMCB)" "300000|3001000.00|10.0033"
su_eq "buyer ledger debits = cost basis" "-3001000.00" "SELECT sum(amount) FROM public.cash_ledger WHERE user_id='$M_B' AND kind='order_buy';"

section "M1/M2 round trip in odd lots: closed position cost = cash paid"
mo "$M_B" MMCB sell limit 1 10.05 >/dev/null; mo "$M_C" MMCB buy limit 1 10.05 >/dev/null
# 3,001,000.00 - round(3,001,000.00 / 300,000 = 10.00333) = 3,000,990.00; avg 10.0033367 -> 10.0033
check "sell 1: 10.00 removed" "$(mpos "$M_B" MMCB)" "299999|3000990.00|10.0033"
mo "$M_B" MMCB sell limit 99999 10.02 >/dev/null; mo "$M_C" MMCB buy limit 99999 10.02 >/dev/null
# round(3,000,990.00 x 99,999 / 299,999 = 1,000,323.3334) = 1,000,323.33 -> 2,000,666.67
check "sell 99,999: 1,000,323.33 removed" "$(mpos "$M_B" MMCB)" "200000|2000666.67|10.0033"
mo "$M_B" MMCB sell limit 200000 9.99 >/dev/null; mo "$M_C" MMCB buy limit 200000 9.99 >/dev/null
check "sell the rest: position closed" "$(mpos "$M_B" MMCB)" "none"
# proceeds 10.05 + 1,001,989.98 + 1,998,000.00 = 3,000,000.03; cash P/L = -999.97
# realized per sale: 0.05 + 1,666.65 - 2,666.67 = -999.97 (src/lib/trading/realized.ts replays the same)
su_eq "buyer's cash P/L on the round trip = -999.97" "-999.97" "SELECT sum(amount) FROM public.cash_ledger WHERE user_id='$M_B' AND kind IN ('order_buy','order_sell');"
check "counterparty cost basis = its cash paid 3,000,000.03" "$(mpos "$M_C" MMCB)" "300000|3000000.03|10.0000"

section "M2 cents: buy 1 @ 1.00 + 1 @ 1.01, sell 2 x 1 @ 1.10 (formula audit M2 repro)"
mo "$M_S" MMRT sell limit 1 1.00 >/dev/null; mo "$M_P" MMRT buy limit 1 1.00 >/dev/null
mo "$M_S" MMRT sell limit 1 1.01 >/dev/null; mo "$M_P" MMRT buy limit 1 1.01 >/dev/null
check "cost 2.01 for 2 units" "$(mpos "$M_P" MMRT)" "2|2.01|1.0050"
mo "$M_P" MMRT sell limit 1 1.10 >/dev/null; mo "$M_R" MMRT buy limit 1 1.10 >/dev/null
# round(2.01 / 2 = 1.005) = 1.01 (half away from zero), 1.00 stays
check "first sale removes 1.01" "$(mpos "$M_P" MMRT)" "1|1.00|1.0000"
mo "$M_P" MMRT sell limit 1 1.10 >/dev/null; mo "$M_R" MMRT buy limit 1 1.10 >/dev/null
check "second sale closes" "$(mpos "$M_P" MMRT)" "none"
# realized (1.10 - 1.01) + (1.10 - 1.00) = 0.19 = 2.20 - 2.01 (per-sale rounding without carry gave 0.20)
su_eq "cash P/L 0.19 = realized" "0.19" "SELECT sum(amount) FROM public.cash_ledger WHERE user_id='$M_P' AND kind IN ('order_buy','order_sell');"

section "M2 thirds: cost 30.01 for 3 units, sold one by one"
mo "$M_S" MMTH sell limit 1 10.01 >/dev/null; mo "$M_T" MMTH buy limit 1 10.01 >/dev/null
mo "$M_S" MMTH sell limit 2 10.00 >/dev/null; mo "$M_T" MMTH buy limit 2 10.00 >/dev/null
check "3 units cost 30.01, avg 10.0033" "$(mpos "$M_T" MMTH)" "3|30.01|10.0033"
mo "$M_T" MMTH sell limit 1 11 >/dev/null; mo "$M_R" MMTH buy limit 1 11 >/dev/null
# round(30.01 / 3 = 10.00333) = 10.00 -> 20.01 for 2 (avg 10.005)
check "sell 1 of 3 removes 10.00" "$(mpos "$M_T" MMTH)" "2|20.01|10.0050"
mo "$M_T" MMTH sell limit 1 11 >/dev/null; mo "$M_R" MMTH buy limit 1 11 >/dev/null
# round(20.01 / 2 = 10.005) = 10.01 -> 10.00
check "sell 1 of 2 removes 10.01" "$(mpos "$M_T" MMTH)" "1|10.00|10.0000"
mo "$M_T" MMTH sell limit 1 11 >/dev/null; mo "$M_R" MMTH buy limit 1 11 >/dev/null
check "last unit closes" "$(mpos "$M_T" MMTH)" "none"
su_eq "cash P/L 33.00 - 30.01 = 2.99 (= 1.00 + 0.99 + 1.00 realized)" "2.99" "SELECT sum(amount) FROM public.cash_ledger WHERE user_id='$M_T' AND kind IN ('order_buy','order_sell');"

section "L1 resting order average fill price is exact (formula audit L1 repro)"
mo "$M_S" MMFP sell limit 1 10.00 >/dev/null
M_ASK2=$(mo_id "$M_S" MMFP sell limit 2 10.01)
R=$(mo "$M_F" MMFP buy limit 6 10.02); M_FO=$(cut -d'|' -f1 <<<"$R")
# 10.00 + 20.02 = 30.02 for 3 -> 10.00667 -> 10.0067
check "aggressor: 3 filled at 30.02 / 3" "$(mstat "$R")" "3|10.0067|partial"
mo "$M_S" MMFP sell limit 3 10.02 >/dev/null
# (10.00 + 20.02 + 30.06) / 6 = 60.08 / 6 = 10.013333 -> 10.0133 (the running average gave 10.0134)
su_eq "resting fill: filled_price from the exact notional" "filled|6|60.08|10.0133" "SELECT status || '|' || trim_scale(filled_qty) || '|' || filled_notional || '|' || filled_price FROM public.orders WHERE id='$M_FO';"
su_eq "order notional = its ledger debits" "-60.08" "SELECT sum(amount) FROM public.cash_ledger WHERE ref_order_id='$M_FO';"
su_eq "resting ask: 2 x 10.01 = 20.02" "filled|20.02|10.0100" "SELECT status || '|' || filled_notional || '|' || filled_price FROM public.orders WHERE id='$M_ASK2';"

section "M3 buying power = cash - resting buy reserve (K4)"
q service "SELECT public.post_cash_movement('$M_G','deposit',1000,NULL,'m','$ADMIN');" >/dev/null
M_G1=$(mo_id "$M_G" MMBP buy limit 3 50.00)
M_G2=$(mo_id "$M_G" MMBP buy limit 2 45.50)
# 3 x 50.00 + 2 x 45.50 = 241.00 reserved; 1,000.00 - 241.00 = 759.00
su_eq "open_buy_reserve = 241.00" "241.00" "SELECT round(public.open_buy_reserve('$M_G'), 2);"
expect_eq "buying_power = 759.00" service "759.00" "SELECT public.buying_power('$M_G');"
expect_eq "buying_power without a portfolio = 0.00" service "0.00" "SELECT public.buying_power('$M_N');"
mo "$M_S" MMBP sell limit 1 50.00 >/dev/null
# cash 950.00, reserve 2 x 50.00 + 91.00 = 191.00 -> 759.00 (a fill moves cash and reserve together)
expect_eq "after a partial fill: still 759.00" service "950.00|759.00" "SELECT (SELECT cash_balance FROM public.portfolios WHERE user_id='$M_G') || '|' || public.buying_power('$M_G');"
expect_err "a buy over buying power is refused (13 x 59.00 = 767.00 > 759.00)" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$M_G','MMBP','brand','buy','limit',13,59.00);"
check "a buy of exactly the buying power is accepted (759.00 = 15 x 50.60)" "$(mstat "$(mo "$M_G" MMBP buy limit 15 50.60)")" "0||open"
expect_eq "buying power now 0.00" service "0.00" "SELECT public.buying_power('$M_G');"
for fn in "open_buy_reserve(uuid)" "buying_power(uuid)" "portfolio_positions(uuid)"; do
  name=${fn%%(*}
  expect_err "anon cannot EXECUTE $name" anon "permission denied for function $name" "SELECT public.$name('$M_G');"
  expect_err "authenticated cannot EXECUTE $name" "$M_G" "permission denied for function $name" "SELECT public.$name('$M_G');"
done
expect_err "authenticated cannot EXECUTE money_prorata" "$M_G" "permission denied for function money_prorata" "SELECT public.money_prorata(1, 1, 3);"
su_eq "money_prorata rounds half away from zero on the cent" "1.01|10.00|10.01|-1.01|0.02" \
  "SELECT public.money_prorata(2.01, 1, 2) || '|' || public.money_prorata(30.01, 1, 3) || '|' || public.money_prorata(20.01, 1, 2) || '|' || public.money_prorata(-2.01, 1, 2) || '|' || public.money_prorata(0.05, 1, 3);"

section "M3 market buy reserved at the band top on the tick"
# MMMK: ref 50.00 -> band 40.00..60.00; ask 10 @ 41; a market buy of 10 reserves 10 x 60.00 = 600.00.
mo "$M_S" MMMK sell limit 10 41 >/dev/null
q service "SELECT public.post_cash_movement('$M_H','deposit',599.99,NULL,'m','$ADMIN');" >/dev/null
expect_err "cash 599.99 < 600.00 reserve: refused (the trade page shows the same 600.00 maximum)" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$M_H','MMMK','brand','buy','market',10,NULL);"
q service "SELECT public.post_cash_movement('$M_H','deposit',0.01,NULL,'m','$ADMIN');" >/dev/null
check "cash 600.00: fills 10 @ 41 and pays 410.00" "$(mstat "$(mo "$M_H" MMMK buy market 10 NULL)")|$(cash "$M_H")" "10|41.0000|filled|190.00"
# MMTK: ref 10.01 -> band 8.008..12.012, ticks 8.01..12.01. Reserve 1,000 x 12.01 = 12,010.00 (not 12,012.00).
mo "$M_S" MMTK sell limit 1000 12.01 >/dev/null
q service "SELECT public.post_cash_movement('$M_K','deposit',12010,NULL,'m','$ADMIN');" >/dev/null
check "cash 12,010.00 covers a market buy of 1,000 (reserve at 12.01)" "$(mstat "$(mo "$M_K" MMTK buy market 1000 NULL)")|$(cash "$M_K")" "1000|12.0100|filled|0.00"
# Size check at the tick: 416,319 x 12.01 = 4,999,991.19 (ok; at 12.012 it was 5,000,823.83); 416,320 x 12.01 = 5,000,003.20
expect_err "market 416,319 is within the size limit at the tick (fails only on cash)" service "INSUFFICIENT_CASH" "SELECT * FROM public.match_order('$M_K2','MMTK','brand','buy','market',416319,NULL);"
expect_err "market 416,320 exceeds 5,000,000 at the tick" service "ORDER_TOO_LARGE" "SELECT * FROM public.match_order('$M_K2','MMTK','brand','buy','market',416320,NULL);"
expect_err "limit above the top tick is out of band" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$M_K2','MMTK','brand','buy','limit',1,12.02);"

section "M4 withdrawals cannot consume reserved cash; sign per kind"
q service "SELECT public.post_cash_movement('$M_W','deposit',90,NULL,'m','$ADMIN');" >/dev/null
M_WO=$(mo_id "$M_W" MMBP buy limit 1 45.00)
expect_err "withdraw 90.00 with 45.00 reserved" service "CASH_RESERVED" "SELECT public.post_cash_movement('$M_W','withdrawal',-90,NULL,NULL,'$ADMIN');"
expect_err "withdraw 45.01 with 45.00 reserved" service "CASH_RESERVED" "SELECT public.post_cash_movement('$M_W','withdrawal',-45.01,NULL,NULL,'$ADMIN');"
expect_eq "withdraw 45.00 leaves exactly the reserve" service "45.00" "SELECT public.post_cash_movement('$M_W','withdrawal',-45,NULL,NULL,'$ADMIN');"
expect_err "negative adjustment into the reserve" service "CASH_RESERVED" "SELECT public.post_cash_movement('$M_W','adjustment',-0.01,NULL,NULL,'$ADMIN');"
expect_eq "positive adjustment" service "45.50" "SELECT public.post_cash_movement('$M_W','adjustment',0.50,NULL,NULL,'$ADMIN');"
expect_eq "negative adjustment down to the reserve" service "45.00" "SELECT public.post_cash_movement('$M_W','adjustment',-0.50,NULL,NULL,'$ADMIN');"
expect_err "negative deposit" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','deposit',-5,NULL,NULL,'$ADMIN');"
expect_err "zero deposit" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','deposit',0,NULL,NULL,'$ADMIN');"
expect_err "positive withdrawal" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','withdrawal',5,NULL,NULL,'$ADMIN');"
expect_err "zero withdrawal" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','withdrawal',0,NULL,NULL,'$ADMIN');"
expect_err "zero adjustment" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','adjustment',0,NULL,NULL,'$ADMIN');"
expect_err "positive order_buy" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','order_buy',1,NULL,NULL,'$ADMIN');"
expect_err "negative order_sell" service "INVALID_AMOUNT" "SELECT public.post_cash_movement('$M_W','order_sell',-1,NULL,NULL,'$ADMIN');"
check "refused movements left no trace" "$(cash "$M_W")|$(su "SELECT count(*) FROM public.cash_ledger WHERE user_id='$M_W';")" "45.00|4"
expect_ok "cancel the resting buy" service "SELECT * FROM public.cancel_order('$M_W','$M_WO');"
expect_eq "then everything can be withdrawn" service "0.00" "SELECT public.post_cash_movement('$M_W','withdrawal',-45,NULL,NULL,'$ADMIN');"
expect_err "and not a cent more" service "INSUFFICIENT_CASH" "SELECT public.post_cash_movement('$M_W','withdrawal',-0.01,NULL,NULL,'$ADMIN');"

section "reference price rules (tick, >= 0.05, <= 1,000,000,000)"
expect_err "off-tick 10.005" service "INVALID_PRICE" "UPDATE public.brands SET reference_price=10.005 WHERE symbol='MMRF';"
expect_err "0.04: its band has a single tick" service "INVALID_PRICE" "UPDATE public.brands SET reference_price=0.04 WHERE symbol='MMRF';"
expect_err "negative" service "INVALID_PRICE|violates check" "UPDATE public.brands SET reference_price=-1 WHERE symbol='MMRF';"
expect_err "above 1,000,000,000" service "INVALID_PRICE" "UPDATE public.brands SET reference_price=1000000000.01 WHERE symbol='MMRF';"
expect_ok "0.05 accepted (band 0.04..0.06)" service "UPDATE public.brands SET reference_price=0.05 WHERE symbol='MMRF';"
expect_ok "1,000,000,000 accepted" service "UPDATE public.brands SET reference_price=1000000000 WHERE symbol='MMRF';"
expect_ok "0 (not set) accepted while unlisted" service "UPDATE public.brands SET reference_price=0 WHERE symbol='MMRF';"
expect_err "platform admin through the API: off-tick refused" "$ADMIN" "INVALID_PRICE" "UPDATE public.brands SET reference_price=7.777 WHERE symbol='MMRF';"
check "even the migration owner cannot insert a listed instrument at 0.03" \
  "$(su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('MMRX','mmrx','m','X',0.03,true);" 2>&1 | grep -o INVALID_PRICE)" "INVALID_PRICE"
q "$BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('MMRF','halal');" >/dev/null
su "ALTER TABLE public.brands DISABLE TRIGGER trg_brands_reference_price; UPDATE public.brands SET reference_price=12.345 WHERE symbol='MMRF'; ALTER TABLE public.brands ENABLE TRIGGER trg_brands_reference_price;" >/dev/null
expect_err "a legacy off-tick price cannot be listed" service "INVALID_PRICE" "SELECT * FROM public.set_instrument_published('MMRF', true, '$ADMIN');"
expect_ok "a valid price replaces it" service "UPDATE public.brands SET reference_price=12.34 WHERE symbol='MMRF';"
expect_eq "and the instrument can be listed" service "t" "SELECT published FROM public.set_instrument_published('MMRF', true, '$ADMIN');"
expect_ok "and delisted again" service "SELECT * FROM public.set_instrument_published('MMRF', false, '$ADMIN');"

section "H1 portfolio_positions: last trade, else band reference; reserved units"
mo "$M_C" MMNT sell limit 2 24 >/dev/null
# MMCB last trade 9.99 (today), band reference 10 (no trade before today); MMNT never traded: reference 20, 2 units reserved.
expect_eq "valuation inputs from the database" service "MMCB|300000|3000000.03|10.0000|0|9.99|10|true
MMNT|5|90.00|18.0000|2|-|20|true" \
  "SELECT symbol || '|' || trim_scale(qty) || '|' || cost_basis || '|' || avg_price || '|' || trim_scale(reserved_qty) || '|' || coalesce(trim_scale(last_price)::text, '-') || '|' || trim_scale(band_reference) || '|' || published FROM public.portfolio_positions('$M_C') ORDER BY symbol;"
expect_eq "no row for someone without holdings" service "0" "SELECT count(*) FROM public.portfolio_positions('$M_N');"

section "cost basis bookkeeping"
# A row written without a cost basis (fixture, manual repair) gets round(qty x avg_price, 2).
su_eq "insert without cost_basis: round(3 x 10.0033, 2) = 30.01" "30.01" "INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price) VALUES ('$M_X','MMRT','brand',3,10.0033) RETURNING cost_basis;"
su "DELETE FROM public.positions WHERE user_id='$M_X';" >/dev/null
# The migration's backfill replays issuances and trades exactly like apply_trade_position.
M_USERS="'$M_S','$M_B','$M_C','$M_P','$M_R','$M_T','$M_F','$M_G','$M_H','$M_K','$M_W'"
M_SNAP="SELECT string_agg(user_id || ':' || symbol || ':' || trim_scale(qty) || ':' || cost_basis || ':' || avg_price, ',' ORDER BY user_id, symbol) FROM public.positions WHERE user_id IN ($M_USERS);"
M_BEFORE=$(su "$M_SNAP")
M_CB_FILE=$(ls "$REPO"/supabase/migrations/*_exact_cost_basis.sql 2>/dev/null | head -1)
awk '/^DO \$\$/{f=1} f{print} /^END \$\$;/{if(f) exit}' "$M_CB_FILE" > "$WORK/m_backfill.sql"
if out=$("${PSQL[@]}" -1 -c "ALTER TABLE public.positions ALTER COLUMN cost_basis DROP NOT NULL; UPDATE public.positions SET cost_basis = NULL WHERE user_id IN ($M_USERS);" -f "$WORK/m_backfill.sql" -c "ALTER TABLE public.positions ALTER COLUMN cost_basis SET NOT NULL;" 2>&1 >/dev/null); then
  check "backfill replay reproduces every cost basis to the cent" "$(su "$M_SNAP")" "$M_BEFORE"
else
  bad "backfill replay reproduces every cost basis to the cent" "$out"
fi
su_eq "cost_basis is NOT NULL again" "NO" "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='positions' AND column_name='cost_basis';"

section "M money invariants over every scenario so far"
su_eq "positions: avg_price = round(cost_basis / qty, 4)" "0" "SELECT count(*) FROM public.positions WHERE avg_price <> round(cost_basis / qty, 4);"
su_eq "positions: no negative cost basis" "0" "SELECT count(*) FROM public.positions WHERE cost_basis < 0;"
su_eq "orders with executions: filled_notional = sum of their fill amounts" "0" "
  SELECT count(*) FROM public.orders o
    JOIN (SELECT x.oid, sum(round(x.qty * x.price, 2)) AS notional, sum(x.qty) AS qty
            FROM (SELECT buy_order_id AS oid, qty, price FROM public.trades
                  UNION ALL SELECT sell_order_id, qty, price FROM public.trades) x
           WHERE x.oid IS NOT NULL GROUP BY x.oid) f ON f.oid = o.id
   WHERE o.filled_qty = f.qty AND (o.filled_notional <> f.notional OR o.filled_price <> round(f.notional / f.qty, 4));"
su_eq "orders with executions: filled_notional = what the ledger moved for them" "0" "
  SELECT count(*) FROM public.orders o
   WHERE o.filled_notional > 0
     AND EXISTS (SELECT 1 FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id)
     AND o.filled_notional <> abs((SELECT coalesce(sum(l.amount), 0) FROM public.cash_ledger l WHERE l.ref_order_id = o.id AND l.kind IN ('order_buy','order_sell')));"
su_eq "no resting buy is left without the cash it reserves" "0" "SELECT count(*) FROM public.portfolios p WHERE p.cash_balance < public.open_buy_reserve(p.user_id);"
