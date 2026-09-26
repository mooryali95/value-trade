# shellcheck shell=bash
# Submission to listing lifecycle (phase 3, agent D). Sourced by
# supabase/tests/security.sh before the global invariants, with its helpers
# in scope.
#
#   L1  a company submits; API callers cannot change a decision directly
#   L2  Shariah review (review_submission): approval creates the instrument
#       off the market, records the reviewer's ruling and flips the status in
#       ONE transaction; rejection needs a reason
#   L3  an existing ruling is never overridden silently (conflict, explicit
#       replacement with a reason, existing 'halal' kept)
#   L4  listing (approve_listing): real reference price + listing + first
#       allocation, all or nothing; decline_listing
#   L5  transitions enforced for every caller; set_instrument_published
#       completes the lifecycle; concurrent reviews serialize
#   L6  reviewer_instruments(): the reviewer's pool includes unpublished
#       instruments; role enforced in SQL
#   L7  EXECUTE grants: service role only

section "D lifecycle: setup"
# security.sh re-applies older migrations that redefine
# product_submissions_guard, set_instrument_published and public_candles
# (20260925110000). Re-apply the phase 3 data migrations: they must be
# re-runnable on a live database, and the checks below need their versions.
# final_low_fixes redefines review_submission after submission_lifecycle.
for mig in submission_lifecycle public_candles_cost integrity_report final_low_fixes; do
  f=$(ls "$REPO"/supabase/migrations/*_"$mig".sql 2>/dev/null | head -1)
  if [ -n "$f" ] && out=$("${PSQL[@]}" -1 -f "$f" 2>&1 >/dev/null); then ok "$mig migration re-applies on the suite's live state"
  else bad "$mig migration re-applies on the suite's live state" "${f:-*_$mig.sql not found} ${out:-}"; fi
done
D_OWN=$(newuser d_owner@test.local); D_FIN=$(newuser d_finance@test.local); D_REV=$(newuser d_reviewer@test.local)
D_REV2=$(newuser d_reviewer2@test.local); D_OUT=$(newuser d_outsider@test.local); D_OWN2=$(newuser d_owner2@test.local)
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$D_REV','shariah_board'), ('$D_REV2','shariah_board'), ('$D_FIN','trader');" >/dev/null
D_CO=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('d-co','شركة د','D Co','$D_OWN') RETURNING id;" | head -1)
D_CO2=$(su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('d-co2','شركة د2','D Co 2','$D_OWN2') RETURNING id;" | head -1)
su "INSERT INTO public.company_members (company_id, user_id, role) VALUES ('$D_CO','$D_FIN','finance')
    ON CONFLICT DO NOTHING;" >/dev/null
# DCON: the company's own unlisted instrument with a non-compliant ruling in
# force. DKEP: its own instrument with a compliant ruling. DOTH: another
# company's instrument.
su "INSERT INTO public.brands (symbol, slug, name_ar, name_en, reference_price, published, company_id) VALUES
      ('DCON','dcon','قديم','Old Con',0,false,'$D_CO'),
      ('DKEP','dkep','قديم','Old Kep',0,false,'$D_CO'),
      ('DOTH','doth','أخرى','Other',0,false,'$D_CO2'),
      ('DUNP','dunp','غير مدرجة','Unlisted seed',0,false,NULL);" >/dev/null
q "$D_REV" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('DCON','non_halal','Interest-bearing revenue'), ('DKEP','halal','Reviewed');" >/dev/null
check "fixture rulings in force" "$(su "SELECT public.current_shariah_status('DCON') || '|' || public.current_shariah_status('DKEP');")" "non_halal|halal"
dsub() { # dsub <company> <symbol> <as-user>: submit as a company member, print the id
  q "$3" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en, sector)
          VALUES ('$1', auth.uid(), 'brand', '$2', 'منتج $2', 'Product $2', 'Retail') RETURNING id;"
}
dstate() { su "SELECT s.status || '|' || coalesce(b.published::text,'-') || '|' || coalesce(trim_scale(b.reference_price)::text,'-')
               FROM public.product_submissions s LEFT JOIN public.brands b ON b.source_submission_id = s.id WHERE s.id='$1';"; }

section "D L1 submission and direct writes"
DS1=$(dsub "$D_CO" dnew1 "$D_FIN")
check "finance member submits; status forced to pending, symbol normalized" "$(su "SELECT status || '|' || symbol || '|' || (submitted_by = '$D_FIN') FROM public.product_submissions WHERE id='$DS1';")" "pending|DNEW1|true"
expect_err "an invalid symbol is refused at submission" "$D_FIN" "INVALID_SYMBOL" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en) VALUES ('$D_CO', auth.uid(), 'brand', 'BAD SYMBOL', 'x', 'x');"
expect_err "submitter cannot update a submission at all" "$D_FIN" "permission denied" "UPDATE public.product_submissions SET name_en='x' WHERE id='$DS1';"
expect_err "reviewer cannot update a submission directly" "$D_REV" "permission denied" "UPDATE public.product_submissions SET status='approved' WHERE id='$DS1';"
expect_err "API caller cannot delete a submission" "$D_OWN" "permission denied" "DELETE FROM public.product_submissions WHERE id='$DS1';"
expect_err "service role cannot approve directly" service "SUBMISSION_TRANSITION_FORBIDDEN" "UPDATE public.product_submissions SET status='approved', reviewer_id='$D_REV' WHERE id='$DS1';"
expect_err "service role cannot rewrite the submitted symbol" service "SUBMISSION_TRANSITION_FORBIDDEN" "UPDATE public.product_submissions SET symbol='DZZZ' WHERE id='$DS1';"
expect_err "service role cannot set the ruling link directly" service "SUBMISSION_TRANSITION_FORBIDDEN" "UPDATE public.product_submissions SET shariah_decision_id=(SELECT id FROM public.shariah_decisions LIMIT 1) WHERE id='$DS1';"
expect_ok "service role may still correct descriptive fields of a pending submission" service "UPDATE public.product_submissions SET sector='Retail trade' WHERE id='$DS1';"
DSX=$(q "$D_OWN" "INSERT INTO public.product_submissions (company_id, submitted_by, asset_class, symbol, name_ar, name_en, status, listing_decided_by, listing_reason, shariah_decision_id)
                   VALUES ('$D_CO', auth.uid(), 'brand', 'DFAKE', 'x', 'x', 'listed', auth.uid(), 'forged', (SELECT id FROM public.shariah_decisions LIMIT 1)) RETURNING id;")
check "an insert cannot forge a decision" "$(su "SELECT status || '|' || coalesce(listing_decided_by::text,'') || '|' || coalesce(listing_reason,'') || '|' || coalesce(shariah_decision_id::text,'') FROM public.product_submissions WHERE id='$DSX';")" "pending|||"

section "D L2 Shariah review"
expect_err "authenticated reviewer cannot call review_submission directly" "$D_REV" "permission denied" "SELECT * FROM public.review_submission('$DS1', auth.uid(), 'approved', NULL);"
expect_err "review_submission refuses a caller without the reviewer role" service "FORBIDDEN" "SELECT * FROM public.review_submission('$DS1', '$ADMIN', 'approved', NULL);"
expect_err "review_submission refuses a missing reviewer" service "FORBIDDEN" "SELECT * FROM public.review_submission('$DS1', NULL, 'approved', NULL);"
expect_err "review_submission refuses an unknown decision" service "INVALID_INPUT" "SELECT * FROM public.review_submission('$DS1', '$D_REV', 'listed', NULL);"
expect_err "rejection needs a reason of 10+ characters" service "REJECTION_REASON_REQUIRED" "SELECT * FROM public.review_submission('$DS1', '$D_REV', 'rejected', ' short   ');"
expect_err "unknown submission" service "SUBMISSION_NOT_FOUND" "SELECT * FROM public.review_submission(gen_random_uuid(), '$D_REV', 'approved', NULL);"
RULINGS0=$(su "SELECT count(*) FROM public.shariah_decisions;")
expect_eq "approval: instrument created, ruling recorded, status flipped" service "approved|DNEW1|true|" \
  "SELECT status || '|' || symbol || '|' || ruling_recorded || '|' || coalesce(previous_ruling,'') FROM public.review_submission('$DS1', '$D_REV', 'approved', 'Compliant activity');"
check "instrument off the market with no reference price, owned by the company" \
  "$(su "SELECT published || '|' || trim_scale(reference_price) || '|' || (company_id = '$D_CO') || '|' || name_en || '|' || slug FROM public.brands WHERE source_submission_id='$DS1';")" "false|0|true|Product dnew1|dnew1"
check "the reviewer's ruling is linked and attributed" \
  "$(su "SELECT d.status || '|' || (d.reviewer_id = '$D_REV') || '|' || (d.updated_by = '$D_REV') || '|' || d.reason || '|' || (s.reviewer_id = '$D_REV') || '|' || (s.reviewed_at IS NOT NULL)
         FROM public.product_submissions s JOIN public.shariah_decisions d ON d.id = s.shariah_decision_id WHERE s.id='$DS1';")" "halal|true|true|Compliant activity|true|true"
check "exactly one ruling written" "$(su "SELECT count(*) - $RULINGS0 FROM public.shariah_decisions;")" "1"
check "approval audited" "$(su "SELECT count(*) || '|' || bool_and(actor_id = '$D_REV') || '|' || bool_and((metadata->>'rulingRecorded')::boolean) FROM public.audit_log WHERE action='submission.approve' AND entity_id='$DS1';")" "1|true|true"
expect_err "a decided submission cannot be reviewed again" service "SUBMISSION_NOT_PENDING" "SELECT * FROM public.review_submission('$DS1', '$D_REV2', 'rejected', 'Second opinion differs');"
DS2=$(dsub "$D_CO" DREJ "$D_OWN")
expect_eq "rejection with a reason" service "rejected|false" "SELECT status || '|' || ruling_recorded FROM public.review_submission('$DS2', '$D_REV', 'rejected', '  Missing audited statements  ');"
check "rejection stores the trimmed reason, creates nothing" \
  "$(su "SELECT s.status || '|' || s.review_reason || '|' || coalesce(s.shariah_decision_id::text,'none') || '|' || (SELECT count(*) FROM public.brands WHERE symbol='DREJ') || '|' || (SELECT count(*) FROM public.shariah_decisions WHERE symbol='DREJ') FROM public.product_submissions s WHERE s.id='$DS2';")" \
  "rejected|Missing audited statements|none|0|0"
RT0=$(su "SELECT count(*) FROM public.shariah_decisions WHERE symbol IN ('DOTH','TSTA');")
DS3=$(dsub "$D_CO" DOTH "$D_OWN")
expect_err "symbol of another company's instrument" service "SYMBOL_TAKEN" "SELECT * FROM public.review_submission('$DS3', '$D_REV', 'approved', NULL);"
DS4=$(dsub "$D_CO" TSTA "$D_OWN")
expect_err "symbol of a seeded instrument with no company" service "SYMBOL_TAKEN" "SELECT * FROM public.review_submission('$DS4', '$D_REV', 'approved', NULL);"
check "refused approvals leave everything pending and unchanged" \
  "$(su "SELECT string_agg(status, ',' ORDER BY symbol) FROM public.product_submissions WHERE id IN ('$DS3','$DS4');")|$(su "SELECT count(*) FROM public.shariah_decisions WHERE symbol IN ('DOTH','TSTA');")|$(su "SELECT (company_id = '$D_CO2') FROM public.brands WHERE symbol='DOTH';")" \
  "pending,pending|$RT0|t"

section "D L3 an existing ruling is never overridden silently"
DS5=$(dsub "$D_CO" DCON "$D_OWN")
RC0=$(su "SELECT count(*) FROM public.shariah_decisions WHERE symbol='DCON';")
expect_err "approval refused while a non-compliant ruling is in force" service "SHARIAH_RULING_CONFLICT" "SELECT * FROM public.review_submission('$DS5', '$D_REV', 'approved', NULL);"
check "refused approval changed nothing (all or nothing)" \
  "$(su "SELECT s.status || '|' || b.name_en || '|' || coalesce(b.source_submission_id::text,'none') || '|' || public.current_shariah_status('DCON') || '|' || (SELECT count(*) FROM public.shariah_decisions WHERE symbol='DCON') FROM public.product_submissions s, public.brands b WHERE s.id='$DS5' AND b.symbol='DCON';")" \
  "pending|Old Con|none|non_halal|$RC0"
expect_err "replacing a ruling needs a reason" service "RULING_CHANGE_REASON_REQUIRED" "SELECT * FROM public.review_submission('$DS5', '$D_REV', 'approved', 'short', true);"
expect_eq "explicit replacement with a reason" service "approved|true|non_halal" \
  "SELECT status || '|' || ruling_recorded || '|' || previous_ruling FROM public.review_submission('$DS5', '$D_REV', 'approved', 'Revenue restructured; now compliant', true);"
check "the new ruling carries the reason; the instrument keeps its listing state and price" \
  "$(su "SELECT public.current_shariah_status('DCON') || '|' || (SELECT reason FROM public.shariah_decisions WHERE symbol='DCON' ORDER BY effective_at DESC, created_at DESC, id DESC LIMIT 1) || '|' || published || '|' || trim_scale(reference_price) || '|' || name_en || '|' || (source_submission_id = '$DS5') FROM public.brands WHERE symbol='DCON';")" \
  "halal|Revenue restructured; now compliant|false|0|Product DCON|true"
DS6=$(dsub "$D_CO" DKEP "$D_OWN")
KEEP_ID=$(su "SELECT id FROM public.shariah_decisions WHERE symbol='DKEP';")
expect_eq "a compliant ruling in force is kept, not duplicated" service "approved|false|halal" \
  "SELECT status || '|' || ruling_recorded || '|' || previous_ruling FROM public.review_submission('$DS6', '$D_REV', 'approved', NULL);"
check "submission linked to the ruling in force" "$(su "SELECT (shariah_decision_id = '$KEEP_ID') || '|' || (SELECT count(*) FROM public.shariah_decisions WHERE symbol='DKEP') FROM public.product_submissions WHERE id='$DS6';")" "true|1"

section "D L4 listing approval"
expect_err "listing refused for a non-admin" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT * FROM public.approve_listing('$DS1', '$D_REV', 10);"
expect_err "listing refused for a pending submission" service "SUBMISSION_NOT_APPROVED" "SELECT * FROM public.approve_listing('$DS3', '$ADMIN', 10);"
expect_err "listing refused for a rejected submission" service "SUBMISSION_NOT_APPROVED" "SELECT * FROM public.approve_listing('$DS2', '$ADMIN', 10);"
expect_err "listing needs a reference price" service "INVALID_PRICE" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', NULL);"
expect_err "listing refuses price 0" service "INVALID_PRICE" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 0);"
expect_err "listing refuses a price off the 0.01 tick" service "INVALID_PRICE" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 10.005);"
expect_err "listing refuses NaN" service "INVALID_PRICE" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 'NaN');"
expect_err "a holder needs a quantity" service "INVALID_INPUT" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 10, '$D_FIN', NULL);"
expect_err "fractional first allocation refused" service "INVALID_QTY" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 10, '$D_FIN', 1.5);"
expect_err "unknown holder refused" service "USER_NOT_FOUND" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 10, gen_random_uuid(), 10);"
check "every refused listing rolled back completely" "$(dstate "$DS1")|$(su "SELECT count(*) FROM public.unit_issuances WHERE symbol='DNEW1';")" "approved|false|0|0"
AUDL=$(su "SELECT count(*) FROM public.audit_log WHERE entity_id IN ('$DS1', (SELECT id::text FROM public.brands WHERE symbol='DNEW1'));")
expect_eq "listing with a first allocation" service "DNEW1|12.5|true|true" \
  "SELECT symbol || '|' || trim_scale(reference_price) || '|' || published || '|' || (issuance_id IS NOT NULL) FROM public.approve_listing('$DS1', '$ADMIN', 12.5, '$D_FIN', 1000, NULL, '  ');"
check "listed, priced, units issued at the reference price" \
  "$(dstate "$DS1")|$(su "SELECT trim_scale(qty) || '@' || trim_scale(price) || '|' || note || '|' || (issued_by = '$ADMIN') FROM public.unit_issuances WHERE symbol='DNEW1';")|$(su "SELECT trim_scale(qty) FROM public.positions WHERE user_id='$D_FIN' AND symbol='DNEW1';")" \
  "listed|true|12.5|1000@12.5|Initial allocation at listing|true|1000"
check "listing decision stamped" "$(su "SELECT (listing_decided_by = '$ADMIN') || '|' || (listing_decided_at IS NOT NULL) || '|' || coalesce(listing_reason, '') FROM public.product_submissions WHERE id='$DS1';")" "true|true|"
check "price change, publish and listing audited in the same transaction" \
  "$(su "SELECT string_agg(action, ',' ORDER BY action) FROM (SELECT action FROM public.audit_log WHERE entity_id IN ('$DS1', (SELECT id::text FROM public.brands WHERE symbol='DNEW1')) ORDER BY created_at DESC LIMIT $(( $(su "SELECT count(*) FROM public.audit_log WHERE entity_id IN ('$DS1', (SELECT id::text FROM public.brands WHERE symbol='DNEW1'));") - AUDL ))) x;")" \
  "brand.publish,brand.reference_price,submission.list"
expect_err "a listed submission cannot be listed again" service "SUBMISSION_NOT_APPROVED" "SELECT * FROM public.approve_listing('$DS1', '$ADMIN', 13);"
expect_err "a listed submission cannot be declined" service "SUBMISSION_NOT_APPROVED" "SELECT * FROM public.decline_listing('$DS1', '$ADMIN', 'Too late to decline');"
expect_eq "the listed instrument is visible to signed-in users" "$D_FIN" "1" "SELECT count(*) FROM public.brands WHERE symbol='DNEW1' AND published;"
# DCON (replaced ruling) listed without an allocation at a custom issue price.
expect_err "issue price must be valid too" service "INVALID_PRICE" "SELECT * FROM public.approve_listing('$DS5', '$ADMIN', 20, '$D_OWN', 5, 0.001);"
check "failed issuance rolled back the price and the listing" "$(dstate "$DS5")" "approved|false|0"
expect_eq "listing without an allocation" service "DCON|true|false" "SELECT symbol || '|' || published || '|' || (issuance_id IS NOT NULL) FROM public.approve_listing('$DS5', '$ADMIN', 20);"
# SHARIAH_NOT_HALAL: the ruling in force changes to 'reviewing' before listing.
DS7=$(dsub "$D_CO" DREV "$D_OWN")
q service "SELECT 1 FROM public.review_submission('$DS7', '$D_REV', 'approved', NULL);" >/dev/null
q "$D_REV2" "INSERT INTO public.shariah_decisions (symbol, status, reason, change_reason) VALUES ('DREV','reviewing','New information received','New information received');" >/dev/null
expect_err "listing needs the compliant ruling in force" service "SHARIAH_NOT_HALAL" "SELECT * FROM public.approve_listing('$DS7', '$ADMIN', 10);"
expect_err "declining needs a reason" service "REJECTION_REASON_REQUIRED" "SELECT * FROM public.decline_listing('$DS7', '$ADMIN', 'no');"
expect_err "declining is for platform admins" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT * FROM public.decline_listing('$DS7', '$D_REV', 'Reviewer cannot decline listings');"
expect_eq "platform admin declines the listing" service "rejected" "SELECT status FROM public.decline_listing('$DS7', '$ADMIN', 'Documents out of date; resubmit');"
check "declined: off the market, ruling kept, reason stored" \
  "$(dstate "$DS7")|$(su "SELECT listing_reason || '|' || (listing_decided_by = '$ADMIN') FROM public.product_submissions WHERE id='$DS7';")|$(su "SELECT count(*) FROM public.shariah_decisions WHERE symbol='DREV';")" \
  "rejected|false|0|Documents out of date; resubmit|true|2"

section "D L5 transitions for every caller"
out=$(su "UPDATE public.product_submissions SET status='pending' WHERE id='$DS1';")
if grep -q SUBMISSION_TRANSITION_FORBIDDEN <<<"$out"; then ok "listed -> pending refused for the migration owner"; else bad "listed -> pending refused for the migration owner" "$out"; fi
out=$(su "UPDATE public.product_submissions SET status='approved' WHERE id='$DS2';")
if grep -q SUBMISSION_TRANSITION_FORBIDDEN <<<"$out"; then ok "rejected -> approved refused for the migration owner"; else bad "rejected -> approved refused for the migration owner" "$out"; fi
out=$(su "UPDATE public.product_submissions SET status='listed' WHERE id='$DS3';")
if grep -q SUBMISSION_TRANSITION_FORBIDDEN <<<"$out"; then ok "pending -> listed refused for the migration owner"; else bad "pending -> listed refused for the migration owner" "$out"; fi
expect_err "the control flag does not let a signed-in user write a decision" "$D_OWN" "permission denied" \
  "SELECT set_config('app.submission_control', 'on', true); UPDATE public.product_submissions SET status='listed' WHERE id='$DS6';"
check "the forged flag changed nothing" "$(su "SELECT status FROM public.product_submissions WHERE id='$DS6';")" "approved"
# Listing from the admin listing screen completes the lifecycle too.
q service "UPDATE public.brands SET reference_price = 7.25 WHERE symbol='DKEP';" >/dev/null
expect_eq "set_instrument_published lists the Shariah-approved submission's instrument" service "DKEP|true" "SELECT symbol || '|' || published FROM public.set_instrument_published('DKEP', true, '$ADMIN');"
check "its submission becomes listed" "$(dstate "$DS6")" "listed|true|7.25"
# Concurrent reviews of one submission: exactly one decision wins.
DS8=$(dsub "$D_CO" DRACE "$D_OWN")
( printf "BEGIN;\nSET LOCAL ROLE service_role;\nSELECT status FROM public.review_submission('%s', '%s', 'approved', NULL);\nSELECT pg_sleep(1.5) AS d_review_race;\nCOMMIT;\n" "$DS8" "$D_REV" | "${PSQL[@]}" >"$WORK/d_race1.out" 2>&1 ) &
for _ in $(seq 1 100); do
  [ "$(su "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%d_review_race%' AND state = 'active' AND pid <> pg_backend_pid();")" == 1 ] && break
  sleep 0.05
done
RACE_D=$(q service "SELECT status FROM public.review_submission('$DS8', '$D_REV2', 'rejected', 'Concurrent rejection attempt');")
wait
if grep -q SUBMISSION_NOT_PENDING <<<"$RACE_D" && [ "$(su "SELECT status || '|' || (reviewer_id = '$D_REV') || '|' || (SELECT count(*) FROM public.shariah_decisions WHERE symbol='DRACE') FROM public.product_submissions WHERE id='$DS8';")" == "approved|true|1" ]; then
  ok "concurrent approve / reject serialized (one decision, one ruling)"
else bad "concurrent approve / reject serialized" "$RACE_D / $(cat "$WORK/d_race1.out")"; fi

section "D L6 reviewer pool"
expect_err "reviewer_instruments refuses other users" service "FORBIDDEN" "SELECT count(*) FROM public.reviewer_instruments('$D_OUT');"
expect_err "reviewer_instruments refuses a missing actor" service "FORBIDDEN" "SELECT count(*) FROM public.reviewer_instruments(NULL);"
expect_err "authenticated users cannot call reviewer_instruments" "$D_REV" "permission denied" "SELECT count(*) FROM public.reviewer_instruments(auth.uid());"
expect_eq "reviewer sees unpublished instruments with no ruling" service "DUNP|false|f||" \
  "SELECT symbol || '|' || published || '|' || (CASE WHEN has_company THEN 't' ELSE 'f' END) || '|' || coalesce(shariah_status,'') || '|' || coalesce(submission_status,'') FROM public.reviewer_instruments('$D_REV') WHERE symbol='DUNP';"
expect_eq "and the ruling / submission status of lifecycle instruments" service "DCON|true|t|halal|listed,DREV|false|t|reviewing|rejected" \
  "SELECT string_agg(symbol || '|' || published || '|' || (CASE WHEN has_company THEN 't' ELSE 'f' END) || '|' || shariah_status || '|' || submission_status, ',' ORDER BY symbol) FROM public.reviewer_instruments('$D_REV') WHERE symbol IN ('DCON','DREV');"
expect_eq "platform admins see the pool too" service "t" "SELECT count(*) > 0 FROM public.reviewer_instruments('$ADMIN');"
expect_ok "a reviewer records a ruling on an unpublished instrument" "$D_REV" "INSERT INTO public.shariah_decisions (symbol, status, reason) VALUES ('DUNP','reviewing','Awaiting documents');"
check "unpublished instrument's ruling in force" "$(su "SELECT public.current_shariah_status('DUNP');")" "reviewing"
expect_err "a non-reviewer cannot record a ruling" "$D_OUT" "row-level security" "INSERT INTO public.shariah_decisions (symbol, status) VALUES ('DUNP','halal');"

section "D L7 grants"
for fn in "review_submission(uuid, uuid, text, text, boolean)" "approve_listing(uuid, uuid, numeric, uuid, numeric, numeric, text)" \
          "decline_listing(uuid, uuid, text)" "reviewer_instruments(uuid)" "set_instrument_published(text, boolean, uuid)" "integrity_report()"; do
  check "EXECUTE $fn: service role only" \
    "$(su "SELECT has_function_privilege('anon', 'public.$fn', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.$fn', 'EXECUTE') || '|' || has_function_privilege('service_role', 'public.$fn', 'EXECUTE');")" "false|false|true"
done
check "product_submissions_guard not callable by API roles" "$(su "SELECT has_function_privilege('anon', 'public.product_submissions_guard()', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.product_submissions_guard()', 'EXECUTE');")" "false|false"
check "no UPDATE / DELETE on product_submissions for API users" \
  "$(su "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='product_submissions' AND grantee IN ('anon','authenticated','PUBLIC') AND privilege_type IN ('UPDATE','DELETE','TRUNCATE');")|$(su "SELECT count(*) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='product_submissions' AND grantee IN ('anon','authenticated') AND privilege_type='UPDATE';")|$(su "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='product_submissions' AND cmd IN ('UPDATE','DELETE','ALL');")" \
  "0|0|0"
check "security definer functions pin search_path" \
  "$(su "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('review_submission','approve_listing','decline_listing','reviewer_instruments','integrity_report','public_candles','product_submissions_guard') AND prosecdef AND NOT (coalesce(proconfig, '{}') @> ARRAY['search_path=public']);")" "0"
