# shellcheck shell=bash
# Onboarding (phase 3, agent R): invitation lifecycle, tamper protection,
# investor access requests, reference codes, the admin pending-activation
# queue and the public company lookup. Sourced by security.sh (helpers and
# fixtures in scope: q, su, ok, bad, section, expect_*, su_eq, check,
# newuser, ADMIN, ALICE, OWNER, VIEWER, CO, FOUNDER, NEWCO, ...).

section "(R) onboarding functions are service_role only"
R_FUNCS=(
  "company_invitations_guard()"
  "company_has_member_email(uuid, text)"
  "create_company_invitation(uuid, text, public.company_role, uuid)"
  "renew_company_invitation(uuid, uuid, boolean)"
  "invitation_preview(uuid)"
  "access_request_reference()"
  "check_access_request_status_ref(text, text)"
  "admin_pending_activations(uuid, integer)"
)
for sig in "${R_FUNCS[@]}"; do
  if [ "$(su "SELECT to_regprocedure('public.$sig') IS NOT NULL;")" != t ]; then bad "public.$sig exists" "function not found"; continue; fi
  su_eq "only service_role may EXECUTE $sig" "false|false|false|true" "SELECT has_function_privilege('public', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('anon', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.$sig', 'EXECUTE') || '|' || has_function_privilege('service_role', 'public.$sig', 'EXECUTE');"
done
expect_err "authenticated cannot call create_company_invitation" "$OWNER" "permission denied for function" "SELECT * FROM public.create_company_invitation('$CO','x@test.local','viewer','$OWNER');"
expect_err "anon cannot call invitation_preview" anon "permission denied for function" "SELECT * FROM public.invitation_preview(gen_random_uuid());"

# ------------------------------------------------------------------ create ---
section "(R) create_company_invitation"
R_INV1=$(q service "SELECT id FROM public.create_company_invitation('$CO','  Inv1@Test.Local ','viewer','$OWNER');")
su_eq "owner creates an invitation (address normalised, stamped by the server)" "inv1@test.local|viewer|pending|$OWNER|true" \
  "SELECT email || '|' || role || '|' || status || '|' || invited_by || '|' || (expires_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute') FROM public.company_invitations WHERE id='$R_INV1';"
expect_err "duplicate pending invitation refused" service "INVITATION_ALREADY_PENDING" "SELECT * FROM public.create_company_invitation('$CO','inv1@test.local','finance','$OWNER');"
expect_err "plain member cannot invite" service "FORBIDDEN" "SELECT * FROM public.create_company_invitation('$CO','m@test.local','viewer','$VIEWER');"
expect_err "outsider cannot invite" service "FORBIDDEN" "SELECT * FROM public.create_company_invitation('$CO','m@test.local','viewer','$ALICE');"
expect_err "owner of another company cannot invite here" service "FORBIDDEN" "SELECT * FROM public.create_company_invitation('$CO','m@test.local','viewer','$FOUNDER');"
expect_err "owners cannot invite a new owner" service "FORBIDDEN" "SELECT * FROM public.create_company_invitation('$CO','m@test.local','owner','$OWNER');"
expect_err "invalid address refused" service "INVALID_INPUT" "SELECT * FROM public.create_company_invitation('$CO','not-an-email','viewer','$OWNER');"
expect_err "role required" service "ROLE_REQUIRED" "SELECT * FROM public.create_company_invitation('$CO','m@test.local',NULL,'$OWNER');"
expect_err "existing member cannot be invited (ALREADY_MEMBER)" service "ALREADY_MEMBER" "SELECT * FROM public.create_company_invitation('$CO','VIEWER@test.local','finance','$OWNER');"
R_ADMIN_INV=$(q service "SELECT id FROM public.create_company_invitation('$NEWCO','second-owner@test.local','owner','$ADMIN');")
if grep -qE '^[0-9a-f-]{36}$' <<<"$R_ADMIN_INV"; then ok "platform admin can invite an owner to any company"; else bad "platform admin can invite an owner to any company" "$R_ADMIN_INV"; fi

# ------------------------------------------------------------------ expiry ---
section "(R) invitation expiry"
R_TOK1=$(su "SELECT token FROM public.company_invitations WHERE id='$R_INV1';")
su "UPDATE public.company_invitations SET expires_at = now() - interval '1 minute' WHERE id='$R_INV1';" >/dev/null
R_INV1U=$(newuser inv1@test.local)
expect_err "expired invitation cannot be accepted" service "INVITATION_EXPIRED" "SELECT public.accept_company_invitation('$R_TOK1','$R_INV1U','inv1@test.local');"
su_eq "a refused accept writes nothing (no update rolled back)" "pending|0" "SELECT status || '|' || (SELECT count(*) FROM public.company_members WHERE user_id='$R_INV1U') FROM public.company_invitations WHERE id='$R_INV1';"
expect_eq "preview reports the effective status" service "expired|Acme|viewer" "SELECT status || '|' || company_name_en || '|' || role FROM public.invitation_preview('$R_TOK1');"
expect_eq "preview of an unknown token is empty" service "0" "SELECT count(*) FROM public.invitation_preview(gen_random_uuid());"
R_INV2=$(q service "SELECT id FROM public.create_company_invitation('$CO','inv1@test.local','finance','$OWNER');")
if grep -qE '^[0-9a-f-]{36}$' <<<"$R_INV2"; then ok "a stale pending invitation no longer blocks a new one"; else bad "a stale pending invitation no longer blocks a new one" "$R_INV2"; fi
su_eq "the stale row is marked expired" "expired" "SELECT status FROM public.company_invitations WHERE id='$R_INV1';"
expect_err "an expired invitation cannot be renewed while a live one exists" service "INVITATION_ALREADY_PENDING" "SELECT id FROM public.renew_company_invitation('$R_INV1','$OWNER',false);"

section "(R) resend / re-issue"
R_TOK2=$(su "SELECT token FROM public.company_invitations WHERE id='$R_INV2';")
su "UPDATE public.company_invitations SET expires_at = now() + interval '1 day' WHERE id='$R_INV2';" >/dev/null
expect_eq "resend extends a live invitation and keeps its link" service "$R_TOK2|true" "SELECT token || '|' || (expires_at > now() + interval '6 days') FROM public.renew_company_invitation('$R_INV2','$OWNER',false);"
R_TOK2B=$(q service "SELECT token FROM public.renew_company_invitation('$R_INV2','$OWNER',true);")
if [ -n "$R_TOK2B" ] && [ "$R_TOK2B" != "$R_TOK2" ]; then ok "re-issue rotates the token"; else bad "re-issue rotates the token" "$R_TOK2 -> $R_TOK2B"; fi
expect_err "the old link is dead after a re-issue" service "INVITATION_NOT_FOUND" "SELECT public.accept_company_invitation('$R_TOK2','$R_INV1U','inv1@test.local');"
expect_err "outsider cannot renew" service "FORBIDDEN" "SELECT id FROM public.renew_company_invitation('$R_INV2','$ALICE',true);"
expect_err "plain member cannot renew" service "FORBIDDEN" "SELECT id FROM public.renew_company_invitation('$R_INV2','$VIEWER',false);"
# Owner invitation of a company created by an approved request (no member
# yet): the platform admin re-issues it.
R_OWNERINV=$(su "SELECT id FROM public.company_invitations WHERE company_id='$NEWCO' AND email='second-owner@test.local';")
su "UPDATE public.company_invitations SET status='expired', expires_at = now() - interval '2 days' WHERE id='$R_OWNERINV';" >/dev/null
expect_eq "platform admin re-issues an expired owner invitation" service "pending|true|owner" "SELECT status || '|' || (expires_at > now() + interval '6 days') || '|' || role FROM public.renew_company_invitation('$R_OWNERINV','$ADMIN',false);"
su_eq "an expired invitation always gets a new token" "0" "SELECT count(*) FROM public.company_invitations WHERE id='$R_OWNERINV' AND token IS NULL;"

# ------------------------------------------------------------------ accept ---
section "(R) accept_company_invitation"
R_TOK2B=$(su "SELECT token FROM public.company_invitations WHERE id='$R_INV2';")
R_OTHER=$(newuser inv-other@test.local)
expect_err "caller address must be the account's own address" service "INVITATION_EMAIL_MISMATCH" "SELECT public.accept_company_invitation('$R_TOK2B','$R_OTHER','inv1@test.local');"
expect_err "someone else's account cannot accept" service "INVITATION_EMAIL_MISMATCH" "SELECT public.accept_company_invitation('$R_TOK2B','$R_OTHER','inv-other@test.local');"
expect_eq "invitee accepts" service "$CO" "SELECT public.accept_company_invitation('$R_TOK2B','$R_INV1U','INV1@test.local');"
su_eq "membership created with the invited role" "finance" "SELECT role FROM public.company_members WHERE company_id='$CO' AND user_id='$R_INV1U';"
expect_err "accept twice refused" service "INVITATION_NOT_PENDING" "SELECT public.accept_company_invitation('$R_TOK2B','$R_INV1U','inv1@test.local');"
expect_err "renewing an accepted invitation refused" service "INVITATION_NOT_PENDING" "SELECT id FROM public.renew_company_invitation('$R_INV2','$OWNER',false);"
# ALREADY_MEMBER at acceptance: the address became a member after the invite.
R_INV3=$(q service "SELECT id FROM public.create_company_invitation('$CO','member-later@test.local','viewer','$OWNER');")
R_ML=$(newuser member-later@test.local)
su "INSERT INTO public.company_members (company_id, user_id, role) VALUES ('$CO','$R_ML','shariah');" >/dev/null
R_TOK3=$(su "SELECT token FROM public.company_invitations WHERE id='$R_INV3';")
expect_err "existing member gets ALREADY_MEMBER" service "ALREADY_MEMBER" "SELECT public.accept_company_invitation('$R_TOK3','$R_ML','member-later@test.local');"
su_eq "role unchanged and invitation untouched" "shariah|pending" "SELECT (SELECT role::text FROM public.company_members WHERE company_id='$CO' AND user_id='$R_ML') || '|' || (SELECT status FROM public.company_invitations WHERE id='$R_INV3');"
expect_err "renewing an invitation of an existing member refused" service "ALREADY_MEMBER" "SELECT id FROM public.renew_company_invitation('$R_INV3','$OWNER',false);"

# ---------------------------------------------------- REST tamper protection ---
section "(R) owners cannot tamper with invitations through the API"
R_INV4=$(q service "SELECT id FROM public.create_company_invitation('$CO','tamper@test.local','viewer','$OWNER');")
expect_err "owner cannot push expires_at out" "$OWNER" "permission denied|FORBIDDEN" "UPDATE public.company_invitations SET expires_at = now() + interval '10 years' WHERE id='$R_INV4';"
expect_err "owner cannot re-address an invitation" "$OWNER" "permission denied|FORBIDDEN" "UPDATE public.company_invitations SET email='attacker@test.local' WHERE id='$R_INV4';"
expect_err "owner cannot forge invited_by" "$OWNER" "permission denied|FORBIDDEN" "UPDATE public.company_invitations SET invited_by='$ALICE' WHERE id='$R_INV4';"
expect_err "owner cannot pick a token" "$OWNER" "permission denied|FORBIDDEN" "UPDATE public.company_invitations SET token=gen_random_uuid() WHERE id='$R_INV4';"
expect_err "owner cannot insert invitations directly" "$OWNER" "permission denied|FORBIDDEN" "INSERT INTO public.company_invitations (company_id, email, role, invited_by, expires_at) VALUES ('$CO','direct@test.local','viewer',auth.uid(), now() + interval '10 years');"
expect_err "owner cannot delete invitations" "$OWNER" "permission denied" "DELETE FROM public.company_invitations WHERE id='$R_INV4';"
expect_err "owner cannot mark an invitation accepted" "$OWNER" "FORBIDDEN" "UPDATE public.company_invitations SET status='accepted' WHERE id='$R_INV4';"
su_eq "invitation unchanged by the attempts" "tamper@test.local|pending|$OWNER|true" "SELECT email || '|' || status || '|' || invited_by || '|' || (expires_at < now() + interval '8 days') FROM public.company_invitations WHERE id='$R_INV4';"
expect_eq "owner revokes a pending invitation" "$OWNER" "revoked" "UPDATE public.company_invitations SET status='revoked' WHERE id='$R_INV4' RETURNING status;"
expect_eq "owner un-revokes it while it is still valid" "$OWNER" "pending" "UPDATE public.company_invitations SET status='pending' WHERE id='$R_INV4' RETURNING status;"
su "UPDATE public.company_invitations SET status='revoked', expires_at = now() - interval '1 minute' WHERE id='$R_INV4';" >/dev/null
expect_err "an expired revoked invitation cannot be un-revoked" "$OWNER" "INVITATION_EXPIRED" "UPDATE public.company_invitations SET status='pending' WHERE id='$R_INV4';"
expect_eq "owner of another company cannot revoke" "$FOUNDER" "" "UPDATE public.company_invitations SET status='revoked' WHERE id='$R_INV3' RETURNING status;"
su_eq "authenticated keeps SELECT and UPDATE(status) only" "SELECT|" "SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) || '|' || COALESCE((SELECT string_agg(column_name || ':' || privilege_type, ',') FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='company_invitations' AND grantee='authenticated' AND privilege_type <> 'SELECT' AND column_name <> 'status'), '') FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='company_invitations' AND grantee='authenticated';"
su_eq "authenticated may update the status column" "t" "SELECT has_column_privilege('authenticated', 'public.company_invitations', 'status', 'UPDATE');"
su_eq "anon has no access to invitations" "f" "SELECT has_table_privilege('anon', 'public.company_invitations', 'SELECT');"
# The invitee read policy trusted the JWT email claim; it is gone (the
# server lists invitations after checking the confirmed address).
q service "SELECT id FROM public.create_company_invitation('$CO','$ALICE@test.local','viewer','$OWNER');" >/dev/null
expect_eq "a JWT email claim alone no longer reads an invitation" "$ALICE" "0" "SELECT count(*) FROM public.company_invitations WHERE lower(email) = lower(auth.jwt() ->> 'email');"
su_eq "no invitation policy uses the JWT email claim" "0" "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='company_invitations' AND (qual ILIKE '%jwt%' OR with_check ILIKE '%jwt%');"
expect_eq "owner still reads the company's invitations" "$OWNER" "t" "SELECT count(*) > 3 FROM public.company_invitations WHERE company_id='$CO';"
expect_eq "platform admin reads every invitation" "$ADMIN" "t" "SELECT count(*) > 0 FROM public.company_invitations WHERE company_id='$NEWCO';"

# --------------------------------------------------------- public lookups ---
section "(R) public company lookup"
R_GHOST=$(su "SELECT set_config('app.skip_creator_owner','on',false); INSERT INTO public.companies (slug, name_ar, name_en, created_by) VALUES ('ghostco','شبح','GhostCo','$ADMIN') RETURNING id;" | tail -1)
su "SELECT set_config('app.skip_creator_owner','',false);" >/dev/null
expect_eq "company without an owner is not searchable" service "0" "SELECT count(*) FROM public.search_companies_public('ghost');"
expect_eq "company without an owner has no join link" service "0" "SELECT count(*) FROM public.get_company_by_slug_public('ghostco');"
expect_eq "company with an owner is searchable" service "acme" "SELECT string_agg(slug, ',') FROM public.search_companies_public('acm');"
expect_eq "join link resolves a company with an owner" service "acme" "SELECT slug FROM public.get_company_by_slug_public('acme');"
expect_eq "LIKE wildcards are literal" service "0|0" "SELECT (SELECT count(*) FROM public.search_companies_public('%%')) || '|' || (SELECT count(*) FROM public.search_companies_public('__'));"
expect_eq "one-character query returns nothing" service "0" "SELECT count(*) FROM public.search_companies_public('a');"
R_BULK=$(newuser bulk-owner@test.local)
su "INSERT INTO public.companies (slug, name_ar, name_en, created_by) SELECT 'bulkco-' || g, 'بلك', 'Bulkco ' || g, '$R_BULK' FROM generate_series(1, 12) g;" >/dev/null
expect_eq "results are capped at 8" service "8" "SELECT count(*) FROM public.search_companies_public('bulkco');"

# ------------------------------------------------ investor access requests ---
section "(R) investor access requests"
R_REQ=$(q service "INSERT INTO public.access_requests (email, full_name, join_method) VALUES ('investor1@test.local','Investor One','investor') RETURNING id;")
if grep -qE '^[0-9a-f-]{36}$' <<<"$R_REQ"; then ok "investor request accepted without a company"; else bad "investor request accepted without a company" "$R_REQ"; fi
R_REF=$(su "SELECT reference_code FROM public.access_requests WHERE id='$R_REQ';")
if grep -qE '^VU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' <<<"$R_REF"; then ok "short reference code assigned ($R_REF)"; else bad "short reference code assigned" "$R_REF"; fi
su_eq "reference codes are unique and well formed" "2000|2000" "SELECT count(DISTINCT c) || '|' || count(*) FILTER (WHERE c ~ '^VU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$') FROM (SELECT public.access_request_reference() AS c FROM generate_series(1, 2000)) s;"
su_eq "every request has a reference code" "0" "SELECT count(*) FROM public.access_requests WHERE reference_code IS NULL;"
expect_err "investor request cannot target a company" service "access_requests_target_shape" "INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id) VALUES ('i2@test.local','I','investor','$CO');"
expect_err "unknown join method refused" service "access_requests_join_method_check" "INSERT INTO public.access_requests (email, full_name, join_method) VALUES ('i2@test.local','I','vip');"
expect_err "anon still cannot file a request directly" anon "permission denied" "INSERT INTO public.access_requests (email, full_name, join_method) VALUES ('i2@test.local','I','investor');"
expect_eq "company owners do not see investor requests" "$OWNER" "0" "SELECT count(*) FROM public.access_requests WHERE join_method='investor';"
expect_eq "platform admin sees investor requests" "$ADMIN" "1" "SELECT count(*) FROM public.access_requests WHERE join_method='investor';"
expect_err "company owner cannot approve an investor" service "FORBIDDEN" "SELECT * FROM public.approve_access_request('$R_REQ','$OWNER',NULL,NULL,NULL);"
expect_eq "status by reference: pending" service "pending|investor" "SELECT status || '|' || join_method FROM public.check_access_request_status_ref(lower('$R_REF'), 'INVESTOR1@test.local');"
expect_eq "status by reference needs the matching address" service "0" "SELECT count(*) FROM public.check_access_request_status_ref('$R_REF', 'someone@test.local');"

section "(R) pending activation queue"
expect_err "queue is platform-admin only" service "FORBIDDEN_ADMIN_REQUIRED" "SELECT * FROM public.admin_pending_activations('$OWNER', 50);"
R_INVCO_BEFORE=$(su "SELECT count(*) FROM public.company_invitations;")
expect_eq "platform admin approves the investor (no company, no company invitation)" service "||" "SELECT COALESCE(invitation_id::text,'') || '|' || COALESCE(invitation_token::text,'') || '|' || COALESCE(company_id::text,'') FROM public.approve_access_request('$R_REQ','$ADMIN',NULL,NULL,NULL);"
su_eq "approval recorded, no invitation row, no role granted" "approved|$ADMIN|$R_INVCO_BEFORE" "SELECT status || '|' || reviewed_by || '|' || (SELECT count(*) FROM public.company_invitations) FROM public.access_requests WHERE id='$R_REQ';"
expect_eq "status by reference: approved" service "approved|investor" "SELECT status || '|' || join_method FROM public.check_access_request_status_ref('$R_REF', 'investor1@test.local');"
expect_eq "approved investor without an account is queued as invited" service "invited_no_account|$R_REF|Investor One" "SELECT source || '|' || request_reference || '|' || full_name FROM public.admin_pending_activations('$ADMIN', 500) WHERE email='investor1@test.local';"
R_INVESTOR=$(newuser investor1@test.local)
expect_eq "once the account exists it is queued under the request" service "investor_request|$R_INVESTOR|false" "SELECT source || '|' || user_id || '|' || email_confirmed FROM public.admin_pending_activations('$ADMIN', 500) WHERE email='investor1@test.local';"
R_NOROLE=$(newuser lonely@test.local)
expect_eq "an account with no role and no company is queued" service "no_role" "SELECT source FROM public.admin_pending_activations('$ADMIN', 500) WHERE user_id='$R_NOROLE';"
q service "SELECT id FROM public.create_company_invitation('$CO','lonely@test.local','viewer','$OWNER');" >/dev/null
expect_eq "the queue shows pending company invitations of a queued account" service "1" "SELECT pending_company_invitations FROM public.admin_pending_activations('$ADMIN', 500) WHERE user_id='$R_NOROLE';"
expect_eq "company members and role holders are not queued" service "0" "SELECT count(*) FROM public.admin_pending_activations('$ADMIN', 500) WHERE user_id IN ('$FOUNDER','$VIEWER','$ADMIN','$BOARD');"
su "INSERT INTO public.user_roles (user_id, role) VALUES ('$R_INVESTOR','trader');" >/dev/null
expect_eq "activated investors leave the queue" service "0" "SELECT count(*) FROM public.admin_pending_activations('$ADMIN', 500) WHERE email='investor1@test.local';"
expect_eq "queue limit is honoured" service "1" "SELECT count(*) FROM public.admin_pending_activations('$ADMIN', 1);"
R_REQ2=$(q service "INSERT INTO public.access_requests (email, full_name, join_method) VALUES ('investor2@test.local','I2','investor') RETURNING id;")
expect_err "company owner cannot reject an investor request" service "FORBIDDEN" "SELECT public.reject_access_request('$R_REQ2','$OWNER',NULL);"
expect_ok "platform admin rejects an investor request" service "SELECT public.reject_access_request('$R_REQ2','$ADMIN','not eligible');"
expect_eq "rejected investor is not queued" service "0" "SELECT count(*) FROM public.admin_pending_activations('$ADMIN', 500) WHERE email='investor2@test.local';"

section "(R) join-request approvals"
R_JREQ=$(q service "INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id) VALUES ('viewer@test.local','V','search','$CO') RETURNING id;")
expect_err "approving a join request of an existing member gives ALREADY_MEMBER" service "ALREADY_MEMBER" "SELECT * FROM public.approve_access_request('$R_JREQ','$OWNER','finance',NULL,NULL);"
R_JREQ2=$(q service "INSERT INTO public.access_requests (email, full_name, join_method, requested_company_id) VALUES ('stale@test.local','S','link','$CO') RETURNING id;")
expect_err "owners cannot approve someone as owner" service "FORBIDDEN" "SELECT * FROM public.approve_access_request('$R_JREQ2','$OWNER','owner',NULL,NULL);"
R_STALE=$(q service "SELECT id FROM public.create_company_invitation('$CO','stale@test.local','viewer','$OWNER');")
su "UPDATE public.company_invitations SET expires_at = now() - interval '1 minute' WHERE id='$R_STALE';" >/dev/null
expect_eq "approval is not blocked by a stale pending invitation" service "$CO" "SELECT company_id FROM public.approve_access_request('$R_JREQ2','$OWNER','viewer',NULL,NULL);"
su_eq "stale invitation expired, new one pending" "expired|pending" "SELECT (SELECT status FROM public.company_invitations WHERE id='$R_STALE') || '|' || (SELECT status FROM public.company_invitations WHERE company_id='$CO' AND email='stale@test.local' AND id <> '$R_STALE');"
