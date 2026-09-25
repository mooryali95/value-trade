# shellcheck shell=bash
# Phase 3 fixer, round 1 (migrations 20260926101500..101700). Sourced by
# supabase/tests/security.sh before the global invariants, with its helpers
# in scope.
#
#   X1  rate limits: one bucket per window, windows longer than 1 hour hold
#   X2  watch lists and price alerts: listed instruments only, capped
#   X3  instruments through the API: descriptive columns only; reference
#       price through set_reference_price (audited); identity frozen once
#       the instrument has a market history
#   X4  names: length limits, rename audit
#   X5  price band: at least one tick each side of the anchor (close 0.04)
#   X6  brand units only; brand cap counts owned instruments
#   X7  pending activations: never-signed-in accounts labelled as such
#   X8  submission documents bucket is private

section "fixer: setup"
# d_lifecycle.sh re-applies older migrations that redefine
# product_submissions_guard and set_instrument_published: re-apply ours.
for mig in fixer_security_hardening fixer_market_rules fixer_execute_allowlist; do
  f=$(ls "$REPO"/supabase/migrations/*_"$mig".sql 2>/dev/null | head -1)
  if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "$mig migration re-applies on the suite's live state"
  else bad "$mig migration re-applies on the suite's live state" "${f:-*_$mig.sql not found} ${out:-}"; fi
done
X_ADMIN=$(newuser x_admin@test.local); X_BOARD=$(newuser x_board@test.local)
X_NOROLE=$(newuser x_norole@test.local); X_OWN=$(newuser x_owner@test.local)
X_BUY=$(newuser x_buyer@test.local); X_SELL=$(newuser x_seller@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$X_ADMIN','platform_admin'), ('$X_BOARD','shariah_board'),
      ('$X_BUY','trader'), ('$X_SELL','trader');" >/dev/null
X_CO=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('x-co','شركة س','X Co','$X_OWN') RETURNING id;" | head -1)
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published, company_id) VALUES
      ('XLST','xlst','مدرجة','X Listed',10,true,NULL),
      ('XPRE','xpre','قبل الإدراج','X Pre-listing',0,false,'$X_CO'),
      ('XOWN','xown','خاصة','X Owned',12,true,'$X_CO'),
      ('XNEW','xnew','جديدة','X New',0,false,NULL);" >/dev/null
q "$X_BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('XLST','halal'), ('XOWN','halal');" >/dev/null

section "fixer X1 rate limits"
expect_eq "bucket: a window starts on its boundary (x.4 and x.6 s land in the same bucket)" service \
  "2026-09-25 10:00:00+00|2026-09-25 10:00:00+00|2026-09-25 00:00:00+00|2026-09-25 10:59:50+00" \
  "SET LOCAL timezone = 'UTC'; SELECT public.rate_limit_bucket('2026-09-25 10:59:59.4+00', 3600) || '|' || public.rate_limit_bucket('2026-09-25 10:59:59.6+00', 3600) || '|' || public.rate_limit_bucket('2026-09-25 23:59:59.9+00', 86400) || '|' || public.rate_limit_bucket('2026-09-25 10:59:59.6+00', 10);"
R=""; for i in 1 2 3 4; do R+="$(q service "SELECT public.check_rate_limit('x:day', 3, 86400);")"; done
check "a 3-per-day limit refuses the 4th call" "$R" "tttf"
su_eq "the day window is one row, kept after the call" "1|4|86400" "SELECT count(*) || '|' || max(count) || '|' || max(window_seconds) FROM public.rate_limits WHERE key='x:day';"
R=""; for i in 1 2 3 4 5 6; do R+="$(q service "SELECT public.check_rate_limit('x:hour', 5, 3600);")"; done
check "a 5-per-hour limit refuses the 6th call" "$R" "tttttf"
su "INSERT INTO public.rate_limits (key, window_start, count, window_seconds) VALUES
      ('x:old-day', now() - interval '25 hours', 9, 86400), ('x:live-day', now() - interval '23 hours', 9, 86400),
      ('x:old-hour', now() - interval '2 hours', 9, 3600), ('x:legacy', now() - interval '2 hours', 9, NULL);" >/dev/null
q service "SELECT public.check_rate_limit('x:sweep', 1, 60);" >/dev/null
su_eq "cleanup removes rows whose own window ended, keeps live long windows" "x:live-day" "SELECT string_agg(key, ',' ORDER BY key) FROM public.rate_limits WHERE key IN ('x:old-day','x:live-day','x:old-hour','x:legacy');"
expect_err "rate_limit_bucket is not callable by API users" "$X_NOROLE" "permission denied" "SELECT public.rate_limit_bucket(now(), 60);"

section "fixer X2 watch lists and price alerts"
expect_err "cannot watch an unlisted (pre-listing) instrument" "$X_NOROLE" "row-level security" "INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (auth.uid(),'XPRE');"
expect_err "cannot watch a symbol that does not exist" "$X_NOROLE" "row-level security" "INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (auth.uid(),'ZZZ');"
expect_err "cannot set a price alert on an unlisted instrument" "$X_NOROLE" "row-level security" "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) VALUES (auth.uid(),'XPRE','above',1);"
expect_eq "a listed symbol is accepted and stored upper-case" "$X_NOROLE" "XLST" "INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (auth.uid(),' xlst ') RETURNING symbol;"
expect_err "cannot move a watch row to an unlisted symbol" "$X_NOROLE" "row-level security" "UPDATE public.symbol_watchers SET symbol='XPRE' WHERE user_id = auth.uid();"
expect_eq "the owner still reads and deletes their rows" "$X_NOROLE" "1" "WITH d AS (DELETE FROM public.symbol_watchers WHERE user_id = auth.uid() RETURNING 1) SELECT count(*) FROM d;"
expect_err "one request cannot insert more than 100 price alerts" "$X_NOROLE" "ALERT_LIMIT_REACHED" \
  "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) SELECT auth.uid(), 'XLST', 'above', 10 + g FROM generate_series(1, 101) g;"
expect_eq "100 price alerts are accepted" "$X_NOROLE" "100" \
  "WITH i AS (INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) SELECT auth.uid(), 'XLST', 'above', 10 + g FROM generate_series(1, 100) g RETURNING 1) SELECT count(*) FROM i;"
expect_err "the 101st is refused" "$X_NOROLE" "ALERT_LIMIT_REACHED" "INSERT INTO public.price_alerts (user_id, symbol, direction, target_price) VALUES (auth.uid(),'XLST','below',1);"
su "INSERT INTO public.symbol_watchers (user_id, symbol) SELECT '$X_NOROLE', 'XW' || g FROM generate_series(1, 100) g;" >/dev/null
expect_err "the 101st watched symbol is refused" "$X_NOROLE" "WATCHLIST_LIMIT_REACHED" "INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (auth.uid(),'XLST');"
su "DELETE FROM public.symbol_watchers WHERE user_id='$X_NOROLE'; DELETE FROM public.price_alerts WHERE user_id='$X_NOROLE';" >/dev/null

section "fixer X3 instruments through the API"
expect_err "platform admin cannot rename a symbol through the API" "$X_ADMIN" "permission denied" "UPDATE public.brands SET symbol='XZZZ' WHERE symbol='XLST';"
expect_err "platform admin cannot move an instrument to a company through the API" "$X_ADMIN" "permission denied" "UPDATE public.brands SET company_id='$X_CO' WHERE symbol='XLST';"
expect_err "platform admin cannot insert an instrument through the API" "$X_ADMIN" "permission denied" "INSERT INTO public.brands (symbol, slug, name_ar, name_en) VALUES ('XINS','xins','x','x');"
su_eq "no platform-admin write policy is left on brands" "0" "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='brands' AND policyname LIKE 'brands_platform_admin_%' AND cmd <> 'SELECT';"
su_eq "authenticated may update the descriptive columns of brands only" "name_ar,name_en,sector" \
  "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='brands' AND grantee='authenticated' AND privilege_type='UPDATE';"
expect_eq "set_reference_price changes the price and audits it" service "XLST|10.00|12.50|true" \
  "SELECT symbol || '|' || to_char(previous_price, 'FM999990.00') || '|' || to_char(reference_price, 'FM999990.00') || '|' || changed FROM public.set_reference_price('xlst', 12.5, '$X_ADMIN');"
su_eq "one audit row, same transaction" "1|12.5" "SELECT count(*) || '|' || max(metadata->>'to') FROM public.audit_log WHERE action='brand.reference_price' AND metadata->>'symbol'='XLST';"
expect_err "set_reference_price keeps the price rules" service "INVALID_PRICE" "SELECT * FROM public.set_reference_price('XLST', 0.04, '$X_ADMIN');"
expect_err "set_reference_price needs an existing instrument" service "INSTRUMENT_NOT_FOUND" "SELECT * FROM public.set_reference_price('NOPE', 5, '$X_ADMIN');"
expect_err "set_reference_price is not callable by API users" "$X_ADMIN" "permission denied" "SELECT * FROM public.set_reference_price('XLST', 5, auth.uid());"
expect_ok "an instrument with no history can still be renamed by the server" service "UPDATE public.brands SET symbol='XNEW2' WHERE symbol='XNEW';"
q service "SELECT public.issue_units('$X_ADMIN', '$X_SELL', 'XLST', 10, 10, 'x fixture');" >/dev/null
expect_err "symbol of an instrument with a history is frozen, even for the server" service "INSTRUMENT_HAS_HISTORY" "UPDATE public.brands SET symbol='XLS2' WHERE symbol='XLST';"
expect_err "and it cannot move to another company" service "INSTRUMENT_HAS_HISTORY" "UPDATE public.brands SET company_id='$X_CO' WHERE symbol='XLST';"
check "not even from the SQL editor" "$(su "UPDATE public.brands SET symbol='XLS2' WHERE symbol='XLST';" 2>&1 | grep -o INSTRUMENT_HAS_HISTORY)" "INSTRUMENT_HAS_HISTORY"

section "fixer X4 names"
expect_err "company names are at most 120 characters" "$X_OWN" "companies_name_length" "UPDATE public.companies SET name_en = repeat('A', 5000) WHERE id='$X_CO';"
expect_err "instrument names are at most 160 characters" "$X_OWN" "brands_name_length" "UPDATE public.brands SET name_en = repeat('A', 161) WHERE symbol='XOWN';"
expect_ok "owner renames the company's instrument" "$X_OWN" "UPDATE public.brands SET name_en='X Owned Renamed' WHERE symbol='XOWN';"
expect_ok "owner renames the company" "$X_OWN" "UPDATE public.companies SET name_en='X Company' WHERE id='$X_CO';"
su_eq "both renames are audited with before and after" "brand.rename:X Owned>X Owned Renamed,company.rename:X Co>X Company" \
  "SELECT string_agg(action || ':' || (metadata->'from'->>'name_en') || '>' || (metadata->'to'->>'name_en'), ',' ORDER BY action) FROM public.audit_log WHERE actor_id='$X_OWN';"

section "fixer X5 price band anchored on a 0.04 close"
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published) VALUES ('XTIC','xtic','ت','X Tick',0.05,true);" >/dev/null
q "$X_BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('XTIC','halal');" >/dev/null
q service "SELECT public.post_cash_movement('$X_BUY', 'deposit', 1000, NULL, 'x seed', '$X_ADMIN');" >/dev/null
q service "SELECT public.issue_units('$X_ADMIN', '$X_SELL', 'XTIC', 100, 0.05, 'x fixture');" >/dev/null
check "a 0.05 reference lets a trade print at 0.04" "$(mo "$X_SELL" XTIC sell limit 10 0.04 | cut -d'|' -f4)|$(mo "$X_BUY" XTIC buy limit 10 0.04 | cut -d'|' -f2,4)" "open|10|filled"
su "UPDATE public.trades SET created_at = now() - interval '2 days' WHERE symbol='XTIC';" >/dev/null
expect_eq "the previous close 0.04 anchors the band" service "0.04" "SELECT public.band_reference_price('XTIC');"
expect_eq "the band keeps a tick each side: 0.03 .. 0.05" anon "0.03|0.05" "SELECT band_low || '|' || band_high FROM public.public_instrument('xtic');"
check "buy at 0.05 accepted (above the close)" "$(mo "$X_BUY" XTIC buy limit 1 0.05 | cut -d'|' -f4)" "open"
check "sell at 0.03 accepted (below the close)" "$(mo "$X_SELL" XTIC sell limit 1 0.03 | cut -d'|' -f2,4)" "1|filled"
expect_err "0.06 is outside the band" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$X_BUY','XTIC','brand','buy','limit',1,0.06);"
expect_err "0.02 is outside the band" service "PRICE_OUT_OF_BAND" "SELECT * FROM public.match_order('$X_SELL','XTIC','brand','sell','limit',1,0.02);"
expect_eq "every anchor from 0.05 keeps the plain ±20% edges" service "0.04|0.06|80.00|120.00|8.01|12.00" \
  "SELECT (SELECT low_tick || '|' || high_tick FROM public.band_tick_edges(0.05)) || '|' || (SELECT low_tick || '|' || high_tick FROM public.band_tick_edges(100)) || '|' || (SELECT low_tick || '|' || high_tick FROM public.band_tick_edges(10.005));"
for o in $(su "SELECT id || ':' || user_id FROM public.orders WHERE symbol='XTIC' AND status IN ('open','partial');"); do
  q service "SELECT * FROM public.cancel_order('${o#*:}', '${o%%:*}');" >/dev/null
done

section "fixer X6 brand units only; brand cap"
expect_err "a submission of another asset class is refused" "$X_OWN" "ASSET_CLASS_NOT_SUPPORTED" \
  "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en) VALUES ('$X_CO', auth.uid(), 'stock', 'XSTK', 'x', 'x');"
expect_eq "a submission defaults to brand units" "$X_OWN" "brand" \
  "INSERT INTO public.product_submissions (company_id, submitted_by, symbol, name_ar, name_en) VALUES ('$X_CO', auth.uid(), 'XBRD', 'x', 'x') RETURNING asset_class;"
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, asset_class, reference_price, published) VALUES ('XSUK','xsuk','ص','X Sukuk','sukuk',10,false);" >/dev/null
q "$X_BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('XSUK','halal');" >/dev/null
expect_err "an instrument that is not a brand unit cannot be listed" service "ASSET_CLASS_NOT_SUPPORTED" "SELECT * FROM public.set_instrument_published('XSUK', true, '$X_ADMIN');"
expect_eq "the brand count covers the roster and the owned instruments" service "2" "SELECT public.company_brand_count('$X_CO');"
su "INSERT INTO public.company_brands (company_id, brand_symbol) SELECT '$X_CO', 'XR' || g FROM generate_series(1, 28) g;" >/dev/null
expect_eq "30 brands in all" service "30" "SELECT public.company_brand_count('$X_CO');"
expect_err "a 31st roster brand is refused" "$X_OWN" "BRAND_CAP_REACHED" "INSERT INTO public.company_brands (company_id, brand_symbol) VALUES ('$X_CO','XR99');"
expect_ok "an owned instrument can be added to the roster (already counted)" "$X_OWN" "INSERT INTO public.company_brands (company_id, brand_symbol) VALUES ('$X_CO','XOWN');"
expect_err "a submission of a new symbol is refused at the cap" "$X_OWN" "BRAND_CAP_REACHED" \
  "INSERT INTO public.product_submissions (company_id, submitted_by, symbol, name_ar, name_en) VALUES ('$X_CO', auth.uid(), 'XCAP', 'x', 'x');"
expect_ok "a resubmission of an owned symbol is not" "$X_OWN" \
  "INSERT INTO public.product_submissions (company_id, submitted_by, symbol, name_ar, name_en) VALUES ('$X_CO', auth.uid(), 'XPRE', 'x', 'x');"

section "fixer X7 pending activations"
su "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;" >/dev/null
X_SIGNED=$(newuser x_signed@test.local)
su "UPDATE auth.users SET last_sign_in_at = now() WHERE id='$X_SIGNED';" >/dev/null
expect_eq "no role, signed in / never signed in" service "no_role|no_role_never_signed_in" \
  "SELECT (SELECT source FROM public.admin_pending_activations('$X_ADMIN', 500) WHERE user_id='$X_SIGNED') || '|' || (SELECT source FROM public.admin_pending_activations('$X_ADMIN', 500) WHERE user_id='$X_NOROLE');"

section "fixer X8 storage"
su_eq "the submission documents bucket exists and is private" "f" "SELECT public FROM storage.buckets WHERE id='submission-docs';"
su_eq "no client policy on its objects" "0" "SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass AND pg_get_expr(polqual, polrelid) ILIKE '%submission-docs%';"

section "fixer EXECUTE grants"
for sig in "rate_limit_bucket(timestamptz, integer)" "set_reference_price(text, numeric, uuid)" "update_shariah_decision(uuid, uuid, text, text, text)" \
           "band_tick_edges(numeric)" "company_brand_count(uuid)" "get_symbol_market_stats(text)" "get_market_snapshot(text[])"; do
  su_eq "service role only: $sig" "false|false|true" "SELECT has_function_privilege('anon', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('service_role', 'public.$sig', 'EXECUTE');"
done
for sig in "user_watch_rows_guard()" "audit_name_change()"; do
  su_eq "trigger only: $sig" "false|false" "SELECT has_function_privilege('anon', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.$sig', 'EXECUTE');"
done
