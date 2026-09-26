# shellcheck shell=bash
# Final low fixes (phase 3, migration 20260926101800 and the in-place change
# of 20260926101650). Sourced by supabase/tests/security.sh before the global
# invariants, with its helpers in scope.
#
#   S9  a NEW ruling that changes the ruling in force on a symbol needs a
#       change reason, for every caller (reviewer through the API, the
#       server, review_submission); the change is audited like an edit
#   J5  rejecting an access request closes that request only; approving one
#       still closes the pending duplicates for the same thing

section "final low fixes: setup"
f=$(ls "$REPO"/supabase/migrations/*_final_low_fixes.sql 2>/dev/null | head -1)
if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "final_low_fixes migration re-applies on the suite's live state"
else bad "final_low_fixes migration re-applies on the suite's live state" "${f:-*_final_low_fixes.sql not found} ${out:-}"; fi
Z_BOARD=$(newuser z_board@test.local); Z_BOARD2=$(newuser z_board2@test.local); Z_ADMIN=$(newuser z_admin@test.local)
Z_OUT=$(newuser z_outsider@test.local); Z_OWN=$(newuser z_owner@test.local); Z_OWN2=$(newuser z_owner2@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$Z_BOARD','shariah_board'), ('$Z_BOARD2','shariah_board'), ('$Z_ADMIN','platform_admin');" >/dev/null
Z_CO=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('z-co','شركة ز','Z Co','$Z_OWN') RETURNING id;" | head -1)
Z_CO2=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('z-co2','شركة ز2','Z Co 2','$Z_OWN2') RETURNING id;" | head -1)
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published, company_id) VALUES
      ('ZFLA','zfla','أ','Z Final A',10,true,NULL),
      ('ZFLR','zflr','ر','Z Final Race',10,true,NULL),
      ('ZFLC','zflc','ج','Z Final Company',0,false,'$Z_CO');" >/dev/null
zstat() { su "SELECT coalesce(public.current_shariah_status('$1'), 'none') || '|' || (SELECT count(*) FROM public.shariah_decisions WHERE symbol='$1');"; }

section "final S9 a new ruling that changes the ruling in force needs a change reason"
expect_ok "the first ruling on a symbol needs no change reason" "$Z_BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('zfla','halal','Compliant activity');"
expect_ok "a new ruling with the same status needs none either" "$Z_BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('ZFLA','halal','Annual re-check');"
check "two rulings, halal in force" "$(zstat ZFLA)" "halal|2"
expect_err "a reviewer cannot change the ruling in force through the API without a reason" "$Z_BOARD" "RULING_CHANGE_REASON_REQUIRED" \
  "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('ZFLA','non_halal','Interest income');"
expect_err "a blank change reason is no reason" "$Z_BOARD" "RULING_CHANGE_REASON_REQUIRED" \
  "INSERT INTO public.shariah_decisions (symbol, status, reason, change_reason) VALUES ('ZFLA','reviewing','Re-check', '   ');"
expect_err "the ruling (reason) text is not a change reason" "$Z_BOARD" "RULING_CHANGE_REASON_REQUIRED" \
  "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('ZFLA','reviewing','Because new documents arrived');"
expect_err "a change reason is at most 600 characters" "$Z_BOARD" "shariah_decisions_change_reason_length" \
  "INSERT INTO public.shariah_decisions (symbol, status, change_reason) VALUES ('ZFLA','reviewing', repeat('x', 601));"
expect_err "the server (service role) must give a reason too" service "RULING_CHANGE_REASON_REQUIRED" \
  "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('ZFLA','reviewing');"
expect_err "a non-reviewer cannot rule, reason or not" "$Z_OUT" "row-level security" \
  "INSERT INTO public.shariah_decisions (symbol, status, change_reason) VALUES ('ZFLA','non_halal','no');"
Z_OUT_ERR=$(q "$Z_OUT" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('ZFLA','non_halal');")
if grep -q "row-level security" <<<"$Z_OUT_ERR" && ! grep -qi "in force" <<<"$Z_OUT_ERR"; then ok "a non-reviewer learns nothing about the ruling in force (RLS refuses first)"
else bad "a non-reviewer learns nothing about the ruling in force (RLS refuses first)" "$Z_OUT_ERR"; fi
expect_err "anon cannot rule" anon "permission denied" \
  "INSERT INTO public.shariah_decisions (symbol, status, change_reason) VALUES ('ZFLA','non_halal','no');"
check "every refused ruling changed nothing" "$(zstat ZFLA)" "halal|2"
Z_D3=$(q "$Z_BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason, change_reason) VALUES ('ZFLA','non_halal','Interest income','  Audited statements show interest income  ') RETURNING id;")
check "with a change reason the new ruling is in force" "$(zstat ZFLA)" "non_halal|3"
su_eq "the change is audited like an edit: previous -> new status, reasons, who, why" \
  "halal|non_halal|Annual re-check|Interest income|true|Audited statements show interest income" \
  "SELECT previous_status || '|' || new_status || '|' || previous_reason || '|' || new_reason || '|' || (changed_by = '$Z_BOARD') || '|' || change_reason FROM public.shariah_decision_audit WHERE decision_id='$Z_D3';"
su_eq "the change reason is stored on the ruling, trimmed" "Audited statements show interest income" "SELECT change_reason FROM public.shariah_decisions WHERE id='$Z_D3';"
su_eq "a ruling with the same status wrote no change audit row" "0" \
  "SELECT count(*) FROM public.shariah_decision_audit a JOIN public.shariah_decisions d ON d.id = a.decision_id WHERE d.symbol='ZFLA' AND d.id <> '$Z_D3';"
expect_err "the change reason is not readable through the API" "$Z_BOARD" "permission denied" "SELECT change_reason FROM public.shariah_decisions WHERE id='$Z_D3';"
expect_eq "board members read it in the decision audit" "$Z_BOARD" "Audited statements show interest income" "SELECT change_reason FROM public.shariah_decision_audit WHERE decision_id='$Z_D3';"
expect_ok "the server passes its reason in the transaction setting" service \
  "SELECT set_config('app.shariah_change_reason', 'Documents under review', true); INSERT INTO public.shariah_decisions (symbol, status) VALUES ('ZFLA','reviewing');"
check "reviewing in force" "$(zstat ZFLA)" "reviewing|4"
su_eq "the server's reason is audited" "non_halal|reviewing|Documents under review" \
  "SELECT a.previous_status || '|' || a.new_status || '|' || a.change_reason FROM public.shariah_decision_audit a JOIN public.shariah_decisions d ON d.id = a.decision_id WHERE d.symbol='ZFLA' ORDER BY a.changed_at DESC LIMIT 1;"
expect_err "editing a ruling still needs a reason (update_shariah_decision)" service "RULING_CHANGE_REASON_REQUIRED" \
  "SELECT * FROM public.update_shariah_decision('$Z_D3', '$Z_BOARD', 'halal', 'x', ' ');"

# Two reviewers at once: the second ruling is checked against the first one
# once it is committed (the per-symbol lock), so a halal ruling without a
# reason cannot silently undo a non_halal ruling recorded a moment before.
q "$Z_BOARD" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('ZFLR','halal');" >/dev/null
Z_PRE="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"$Z_BOARD\",\"role\":\"authenticated\"}',true);"
( printf "BEGIN;\n%s\nINSERT INTO public.shariah_decisions (symbol, status, change_reason) VALUES ('ZFLR','non_halal','Non-compliant revenue');\nSELECT pg_sleep(1.5) AS z_ruling_race;\nCOMMIT;\n" "$Z_PRE" | "${PSQL[@]}" >"$WORK/z_race1.out" 2>&1 ) &
Z_BG=$!
for _ in $(seq 1 50); do
  [ "$(su "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%z_ruling_race%' AND pid <> pg_backend_pid();")" != "0" ] && break
  sleep 0.1
done
Z_RACE=$(q "$Z_BOARD2" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('ZFLR','halal') RETURNING status;")
wait "$Z_BG"
if grep -q "ERROR" "$WORK/z_race1.out"; then bad "concurrent rulings: the first one commits" "$(cat "$WORK/z_race1.out")"; else ok "concurrent rulings: the first one commits"; fi
if grep -qE "ERROR: +.*RULING_CHANGE_REASON_REQUIRED" <<<"$Z_RACE"; then ok "concurrent rulings: the second is checked against the first (needs a reason)"
else bad "concurrent rulings: the second is checked against the first (needs a reason)" "$Z_RACE"; fi
check "concurrent rulings: non_halal stays in force" "$(zstat ZFLR)" "non_halal|2"

# review_submission replacing a ruling passes its reason as the change reason.
q "$Z_BOARD" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('ZFLC','non_halal','Interest-bearing revenue');" >/dev/null
Z_SUB=$(q "$Z_OWN" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en, sector)
          VALUES ('$Z_CO', auth.uid(), 'brand', 'ZFLC', 'منتج', 'Product ZFLC', 'Retail') RETURNING id;")
expect_eq "review_submission replaces the ruling with its reason" service "approved|true|non_halal" \
  "SELECT status || '|' || ruling_recorded || '|' || previous_ruling FROM public.review_submission('$Z_SUB', '$Z_BOARD', 'approved', 'Revenue restructured; now compliant', true);"
su_eq "the replacement is audited with the reviewer's reason" "non_halal|halal|true|Revenue restructured; now compliant" \
  "SELECT a.previous_status || '|' || a.new_status || '|' || (a.changed_by = '$Z_BOARD') || '|' || a.change_reason FROM public.shariah_decision_audit a JOIN public.product_submissions s ON s.shariah_decision_id = a.decision_id WHERE s.id='$Z_SUB';"
for sig in "shariah_decisions_require_change_reason()" "log_shariah_decision_insert()"; do
  su_eq "trigger only: $sig" "false|false" "SELECT has_function_privilege('anon', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.$sig', 'EXECUTE');"
done
su_eq "review_submission: service role only" "false|false|true" \
  "SELECT has_function_privilege('anon', 'public.review_submission(uuid, uuid, text, text, boolean)', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.review_submission(uuid, uuid, text, text, boolean)', 'EXECUTE') || '|' || has_function_privilege('service_role', 'public.review_submission(uuid, uuid, text, text, boolean)', 'EXECUTE');"

section "final J5 rejecting an access request closes that request only"
zreq() { # zreq <name> <join_method> [company] [name_ar] [name_en] -> id (address zdup@test.local)
  q service "INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id, new_company_name_ar, new_company_name_en)
             VALUES ('zdup@test.local', '$1', '$2', ${3:-NULL}, ${4:-NULL}, ${5:-NULL}) RETURNING id;"
}
zst() { su "SELECT string_agg(status, '|' ORDER BY array_position(ARRAY[$1]::uuid[], id)) FROM public.access_requests WHERE id = ANY(ARRAY[$1]::uuid[]);"; }
Z_GEN=$(zreq "Genuine Investor" investor); Z_SPAM=$(zreq "Spam" investor)
q service "SELECT public.reject_access_request('$Z_SPAM','$Z_ADMIN','spam');" >/dev/null
check "rejecting a spam investor request leaves the genuine one from the same address pending" "$(zst "'$Z_SPAM','$Z_GEN'")" "rejected|pending"
su_eq "the genuine request keeps no decision fields" "||" "SELECT coalesce(reviewed_by::text,'') || '|' || coalesce(rejection_reason,'') || '|' || coalesce(reviewed_at::text,'') FROM public.access_requests WHERE id='$Z_GEN';"
expect_ok "the genuine request can still be approved" service "SELECT * FROM public.approve_access_request('$Z_GEN','$Z_ADMIN',NULL,NULL,NULL);"
check "approved on its own" "$(zst "'$Z_GEN'")" "approved"
Z_J1=$(zreq "Join One" search "'$Z_CO'"); Z_J2=$(zreq "Join Two" link "'$Z_CO'"); Z_J3=$(zreq "Join Other" search "'$Z_CO2'")
q service "SELECT public.reject_access_request('$Z_J1','$Z_ADMIN','not now');" >/dev/null
check "rejecting a join request leaves the duplicate for the same company pending" "$(zst "'$Z_J1','$Z_J2','$Z_J3'")" "rejected|pending|pending"
expect_ok "the duplicate is approved later on its own" service "SELECT * FROM public.approve_access_request('$Z_J2','$Z_OWN','viewer',NULL,NULL);"
check "approval does not touch a request for another company" "$(zst "'$Z_J2','$Z_J3'")" "approved|pending"
Z_N1=$(zreq "New One" new_company NULL "'شركة ن'" "'Nu Co'"); Z_N2=$(zreq "New Two" new_company NULL "'شركة ن'" "' nu co '")
Z_N3=$(zreq "New Three" new_company NULL "'شركة أخرى'" "'Other Nu'")
q service "SELECT public.reject_access_request('$Z_N1','$Z_ADMIN','incomplete');" >/dev/null
check "rejecting a new-company request leaves the one with the same names pending" "$(zst "'$Z_N1','$Z_N2','$Z_N3'")" "rejected|pending|pending"
Z_N4=$(zreq "New Four" new_company NULL "'شركة ن'" "'Nu Co'")
expect_ok "approving a new-company request" service "SELECT * FROM public.approve_access_request('$Z_N2','$Z_ADMIN',NULL,'retail','z-nu-co');"
check "approval closes the pending duplicate with the same names (same invitation), not the others" "$(zst "'$Z_N1','$Z_N2','$Z_N4','$Z_N3'")" "rejected|approved|approved|pending"
su_eq "the closed duplicate carries the approval's invitation and reviewer" "true|true" \
  "SELECT (d.resulting_invitation_id = a.resulting_invitation_id AND a.resulting_invitation_id IS NOT NULL) || '|' || (d.reviewed_by = '$Z_ADMIN') FROM public.access_requests d, public.access_requests a WHERE d.id='$Z_N4' AND a.id='$Z_N2';"
su_eq "the rejected request kept its own reason" "incomplete" "SELECT rejection_reason FROM public.access_requests WHERE id='$Z_N1';"
# Later checks count requests: leave none of ours behind.
su "DELETE FROM public.access_requests WHERE lower(btrim(email)) = 'zdup@test.local';" >/dev/null
