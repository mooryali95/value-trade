-- ============================================================================
-- E2E STACK SEED (e2e/stack/start.sh) — SAMPLE DATA ONLY. NEVER RUN AGAINST PRODUCTION.
-- Every company, brand and person below is fictional and labelled as a sample
-- ("شركة تجريبية", "علامة تجريبية", "Sample ..."). Accounts use @preview.local
-- and the password Preview123! (see e2e/README.md for the table).
--
-- Cash enters only through public.post_cash_movement (deposit), units only
-- through public.issue_units (primary issuance), and every trade is produced
-- by public.match_order called with the service role, exactly as the server
-- does. Afterwards, as superuser, timestamps are moved back in time so the
-- ~40 day history, candles and 24h statistics look realistic. The global
-- invariants of supabase/tests/security.sh hold (checked at the end).
-- Journeys create their own users / instruments on top of this (tests/support/db.ts).
-- ============================================================================
\set ON_ERROR_STOP 1
BEGIN;

-- Local-only auth columns used by the auth stub (e2e/stack/gateway.mjs).
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS encrypted_password text,
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS banned_until timestamptz;

CREATE SCHEMA preview;
CREATE TABLE preview.accounts (key text PRIMARY KEY, id uuid NOT NULL, email text NOT NULL);
INSERT INTO preview.accounts VALUES
  ('admin',    'a0000000-0000-4000-8000-000000000001', 'admin@preview.local'),
  ('reviewer', 'a0000000-0000-4000-8000-000000000002', 'reviewer@preview.local'),
  ('owner',    'a0000000-0000-4000-8000-000000000003', 'owner@preview.local'),
  ('owner2',   'a0000000-0000-4000-8000-000000000004', 'owner2@preview.local'),
  ('investor', 'a0000000-0000-4000-8000-000000000011', 'investor@preview.local'),
  ('investor2','a0000000-0000-4000-8000-000000000012', 'investor2@preview.local'),
  ('investor3','a0000000-0000-4000-8000-000000000013', 'investor3@preview.local'),
  ('pending',  'a0000000-0000-4000-8000-000000000021', 'pending@preview.local'),
  ('held',     'a0000000-0000-4000-8000-000000000031', 'held@preview.local');
GRANT USAGE ON SCHEMA preview TO service_role;
GRANT SELECT ON preview.accounts TO service_role;
CREATE FUNCTION preview.uid(_key text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM preview.accounts WHERE key = _key $$;

-- ------------------------------------------------------------- accounts ---
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at, encrypted_password)
SELECT a.id, a.email, jsonb_build_object('full_name', n.full_name),
       now() - interval '58 days', now() - interval '60 days', now() - interval '60 days',
       encode(sha256(convert_to('Preview123!', 'UTF8')), 'hex')
  FROM preview.accounts a
  JOIN (VALUES
    ('admin',    'مدير المنصة (حساب تجريبي)'),
    ('reviewer', 'مراجع شرعي (حساب تجريبي)'),
    ('owner',    'مالك شركة تجريبية أ'),
    ('owner2',   'مالك شركة تجريبية ب'),
    ('investor', 'مستثمر تجريبي ١'),
    ('investor2','مستثمر تجريبي ٢'),
    ('investor3','مستثمر تجريبي ٣'),
    ('pending',  'مستخدم تجريبي بانتظار التفعيل'),
    ('held',     'مستثمر تجريبي موقوف')
  ) AS n(key, full_name) ON n.key = a.key;
-- The not-yet-activated user signed up recently.
UPDATE auth.users SET created_at = now() - interval '2 days', email_confirmed_at = now() - interval '2 days'
 WHERE id = preview.uid('pending');
UPDATE public.profiles SET locale = 'ar';

INSERT INTO public.user_roles (user_id, role) VALUES
  (preview.uid('admin'), 'platform_admin'),
  (preview.uid('reviewer'), 'shariah_board'),
  (preview.uid('investor'), 'trader'),
  (preview.uid('investor2'), 'trader'),
  (preview.uid('investor3'), 'trader');

-- ------------------------------------------------------------ companies ---
INSERT INTO public.companies (id, slug, name_ar, name_en, sector, created_by, created_at) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'sample-company-a', 'شركة تجريبية أ', 'Sample Company A', 'retail', preview.uid('owner'), now() - interval '55 days'),
  ('c0000000-0000-4000-8000-00000000000b', 'sample-company-b', 'شركة تجريبية ب', 'Sample Company B', 'hospitality', preview.uid('owner2'), now() - interval '54 days');
-- (trg_companies_owner adds each creator as the company owner.)
INSERT INTO public.company_members (company_id, user_id, role, invited_by, joined_at) VALUES
  ('c0000000-0000-4000-8000-00000000000a', preview.uid('investor3'), 'viewer', preview.uid('owner'), now() - interval '30 days');

-- Instruments: created off the market, then listed through
-- set_instrument_published once a ruling is in force.
INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, reference_price, published, company_id, created_at) VALUES
  ('SMPA', 'sample-brand-1', 'علامة تجريبية ١', 'Sample Brand 1', 'retail',      25.00, false, 'c0000000-0000-4000-8000-00000000000a', now() - interval '50 days'),
  ('SMPB', 'sample-brand-2', 'علامة تجريبية ٢', 'Sample Brand 2', 'food',        48.50, false, 'c0000000-0000-4000-8000-00000000000a', now() - interval '50 days'),
  ('SMPC', 'sample-brand-3', 'علامة تجريبية ٣', 'Sample Brand 3', 'fashion',     12.40, false, 'c0000000-0000-4000-8000-00000000000b', now() - interval '49 days'),
  ('SMPD', 'sample-brand-4', 'علامة تجريبية ٤', 'Sample Brand 4', 'hospitality', 80.00, false, 'c0000000-0000-4000-8000-00000000000b', now() - interval '49 days'),
  ('SMPE', 'sample-brand-5', 'علامة تجريبية ٥', 'Sample Brand 5', 'retail',      15.00, false, 'c0000000-0000-4000-8000-00000000000b', now() - interval '6 days');

-- Product submissions: approved ones behind the listed brands, one pending.
INSERT INTO public.product_submissions (id, company_id, submitted_by, asset_class, symbol, name_ar, name_en, sector) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a', preview.uid('owner'), 'brand', 'SMPA', 'علامة تجريبية ١', 'Sample Brand 1', 'retail'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a', preview.uid('owner'), 'brand', 'SMPB', 'علامة تجريبية ٢', 'Sample Brand 2', 'food'),
  ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-00000000000a', preview.uid('owner'), 'brand', 'SMPF', 'علامة تجريبية ٦', 'Sample Brand 6', 'retail'),
  ('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-00000000000b', preview.uid('owner2'), 'brand', 'SMPG', 'علامة تجريبية ٧', 'Sample Brand 7', 'fashion');
SET LOCAL session_replication_role = replica;
UPDATE public.product_submissions SET status = 'approved', reviewer_id = preview.uid('admin'),
       review_reason = 'عينة محلية: اكتمل الملف', reviewed_at = now() - interval '51 days',
       submitted_at = now() - interval '53 days', created_at = now() - interval '53 days', updated_at = now() - interval '51 days'
 WHERE id IN ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');
UPDATE public.product_submissions SET submitted_at = now() - interval '3 days', created_at = now() - interval '3 days', updated_at = now() - interval '3 days'
 WHERE id = 'd0000000-0000-4000-8000-000000000006';
UPDATE public.product_submissions SET status = 'rejected', reviewer_id = preview.uid('admin'),
       review_reason = 'عينة محلية: المستندات غير مكتملة', reviewed_at = now() - interval '9 days',
       submitted_at = now() - interval '12 days', created_at = now() - interval '12 days', updated_at = now() - interval '9 days'
 WHERE id = 'd0000000-0000-4000-8000-000000000007';
UPDATE public.brands SET source_submission_id = 'd0000000-0000-4000-8000-000000000001' WHERE symbol = 'SMPA';
UPDATE public.brands SET source_submission_id = 'd0000000-0000-4000-8000-000000000002' WHERE symbol = 'SMPB';
SET LOCAL session_replication_role = origin;

-- Shariah rulings by the sample reviewer (SMPD turns non_halal later).
INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by) VALUES
  ('SMPA', 'halal', 'ملاحظة تجريبية: النشاط مباح ولا توجد إيرادات محرّمة جوهرية.', preview.uid('reviewer'), preview.uid('reviewer')),
  ('SMPB', 'halal', 'ملاحظة تجريبية: النشاط مباح والتمويل متوافق مع الضوابط.', preview.uid('reviewer'), preview.uid('reviewer')),
  ('SMPC', 'reviewing', 'ملاحظة تجريبية: القوائم المالية الأخيرة قيد المراجعة.', preview.uid('reviewer'), preview.uid('reviewer')),
  ('SMPD', 'halal', 'ملاحظة تجريبية: النشاط مباح عند الإدراج.', preview.uid('reviewer'), preview.uid('reviewer')),
  ('SMPE', 'halal', 'ملاحظة تجريبية: النشاط مباح ولا توجد إيرادات محرّمة جوهرية.', preview.uid('reviewer'), preview.uid('reviewer'));
SET LOCAL session_replication_role = replica;
UPDATE public.shariah_decisions SET created_at = now() - interval '48 days', updated_at = now() - interval '48 days', effective_at = now() - interval '48 days' WHERE symbol <> 'SMPE';
UPDATE public.shariah_decisions SET created_at = now() - interval '5 days', updated_at = now() - interval '5 days', effective_at = now() - interval '5 days' WHERE symbol = 'SMPE';
UPDATE public.shariah_decision_audit SET changed_at = now() - interval '48 days' WHERE true;
SET LOCAL session_replication_role = origin;

SELECT count(*) AS listed
  FROM public.brands b CROSS JOIN LATERAL public.set_instrument_published(b.symbol, true, preview.uid('admin')) s
 WHERE b.symbol IN ('SMPA','SMPB','SMPC','SMPD','SMPE') \g /dev/null
UPDATE public.audit_log SET created_at = CASE WHEN metadata->>'symbol' = 'SMPE' THEN now() - interval '5 days' ELSE now() - interval '47 days' END
 WHERE action = 'brand.publish';

-- ------------------------------------------------- funding and issuance ---
CREATE FUNCTION preview.as_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
END $$;
CREATE FUNCTION preview.as_owner() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

DO $$
DECLARE
  r record;
  _admin uuid := preview.uid('admin');
  _ts timestamptz := now() - interval '46 days';
  _id uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('investor', 750000.00), ('investor2', 500000.00), ('investor3', 400000.00), ('held', 120000.00)) v(k, amt) LOOP
    PERFORM preview.as_service();
    PERFORM public.post_cash_movement(preview.uid(r.k), 'deposit', r.amt, NULL, 'تمويل تجريبي أولي (بيانات محلية)', _admin);
    PERFORM preview.as_owner();
    UPDATE public.cash_ledger SET created_at = _ts WHERE user_id = preview.uid(r.k);
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata, created_at)
    VALUES (_admin, 'cash.deposit', 'portfolios', preview.uid(r.k)::text, jsonb_build_object('amount', r.amt), _ts);
  END LOOP;
  -- A top-up two weeks later for the first investor.
  PERFORM preview.as_service();
  PERFORM public.post_cash_movement(preview.uid('investor'), 'deposit', 50000.00, NULL, 'إيداع تجريبي إضافي', _admin);
  PERFORM preview.as_owner();
  UPDATE public.cash_ledger SET created_at = now() - interval '20 days' WHERE user_id = preview.uid('investor') AND amount = 50000.00;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata, created_at)
  VALUES (_admin, 'cash.deposit', 'portfolios', preview.uid('investor')::text, '{"amount":50000}', now() - interval '20 days');

  FOR r IN SELECT * FROM (VALUES
      ('investor', 'SMPA', 20000, 25.00), ('investor2', 'SMPA', 8000, 25.00), ('held', 'SMPA', 1500, 25.00),
      ('investor2', 'SMPB', 10000, 48.50), ('investor3', 'SMPB', 4000, 48.50),
      ('investor3', 'SMPC', 30000, 12.40), ('investor', 'SMPC', 5000, 12.40),
      ('investor', 'SMPD', 6000, 80.00), ('investor3', 'SMPD', 3000, 80.00),
      ('investor2', 'SMPE', 12000, 15.00)) v(k, sym, qty, price) LOOP
    PERFORM preview.as_service();
    _id := public.issue_units(_admin, preview.uid(r.k), r.sym, r.qty, r.price, 'إصدار أولي تجريبي (بيانات محلية)');
    PERFORM preview.as_owner();
    _ts := CASE WHEN r.sym = 'SMPE' THEN now() - interval '5 days' ELSE now() - interval '45 days' END;
    UPDATE public.unit_issuances SET created_at = _ts WHERE id = _id;
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata, created_at)
    VALUES (_admin, 'units.issue', 'unit_issuances', _id::text,
            jsonb_build_object('targetUserId', preview.uid(r.k), 'symbol', r.sym, 'qty', r.qty, 'price', r.price), _ts);
  END LOOP;
END $$;
SET LOCAL session_replication_role = replica;
UPDATE public.positions SET created_at = now() - interval '45 days', updated_at = now() - interval '45 days';
UPDATE public.portfolios SET created_at = now() - interval '46 days';
SET LOCAL session_replication_role = origin;

-- ------------------------------------------------------ trading history ---
-- One seed trade: the seller's limit ask, then the buyer's crossing bid, both
-- through match_order as the service role; then the rows are backdated.
CREATE FUNCTION preview.trade(_seller uuid, _buyer uuid, _sym text, _qty numeric, _price numeric, _ts timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s uuid; b uuid; st text;
BEGIN
  PERFORM preview.as_service();
  SELECT m.order_id INTO s FROM public.match_order(_seller, _sym, 'brand', 'sell', 'limit', _qty, _price) m;
  SELECT m.order_id, m.status INTO b, st FROM public.match_order(_buyer, _sym, 'brand', 'buy', 'limit', _qty, _price) m;
  PERFORM preview.as_owner();
  IF st IS DISTINCT FROM 'filled' THEN RAISE EXCEPTION 'seed trade did not fill: % % @ % (%)', _sym, _qty, _price, st; END IF;
  IF _ts IS NOT NULL THEN
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE public.trades SET created_at = _ts WHERE buy_order_id = b;
    UPDATE public.orders SET created_at = _ts - interval '4 minutes', updated_at = _ts, filled_at = _ts WHERE id = s;
    UPDATE public.orders SET created_at = _ts, updated_at = _ts, filled_at = _ts WHERE id = b;
    UPDATE public.cash_ledger SET created_at = _ts WHERE ref_order_id IN (s, b);
    UPDATE public.positions SET updated_at = _ts WHERE symbol = _sym AND user_id IN (_seller, _buyer);
    PERFORM set_config('session_replication_role', 'origin', true);
  END IF;
END $$;

SELECT setseed(0.4242) \g /dev/null
DO $$
DECLARE
  traders uuid[] := ARRAY[preview.uid('investor'), preview.uid('investor2'), preview.uid('investor3')];
  syms text[] := ARRAY['SMPA', 'SMPB', 'SMPC', 'SMPD'];
  px numeric[] := ARRAY[25.00, 48.50, 12.40, 80.00];
  drift numeric[] := ARRAY[0.004, -0.002, 0.006, -0.001];
  d int; i int; k int; n int;
  day_start timestamptz;
  ts timestamptz;
  p numeric; q numeric;
  seller uuid; buyer uuid;
BEGIN
  FOR d IN REVERSE 40..0 LOOP
    day_start := (date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') - make_interval(days => d)) AT TIME ZONE 'Asia/Riyadh';
    FOR i IN 1..4 LOOP
      CONTINUE WHEN syms[i] = 'SMPD' AND d < 4;          -- SMPD is ruled non_halal 3 days ago
      CONTINUE WHEN d > 0 AND random() < 0.28;           -- quiet days
      n := 1 + floor(random() * CASE WHEN d <= 1 THEN 4 ELSE 3 END)::int;
      FOR k IN 1..n LOOP
        -- Daily random walk, well inside the +/-20% protection band.
        p := round(px[i] * (1 + drift[i] + (random()::numeric - 0.5) * 0.045), 2);
        px[i] := p;
        IF d = 0 THEN
          ts := now() - make_interval(mins => (n - k) * 17 + 3 + floor(random() * 10)::int);
        ELSE
          ts := day_start + interval '9 hours 30 minutes' + make_interval(mins => floor((k - 1) * 360.0 / n + random() * 300.0 / n)::int);
        END IF;
        SELECT t INTO seller FROM unnest(traders) t
          JOIN public.positions ps ON ps.user_id = t AND ps.symbol = syms[i] AND ps.qty >= 100
         ORDER BY random() LIMIT 1;
        CONTINUE WHEN seller IS NULL;
        SELECT least(ps.qty * 0.08, 50 + floor(random()::numeric * 900)) INTO q FROM public.positions ps WHERE ps.user_id = seller AND ps.symbol = syms[i];
        q := greatest(10, floor(q / 10) * 10);
        SELECT t INTO buyer FROM unnest(traders) t
          JOIN public.portfolios pf ON pf.user_id = t AND pf.cash_balance >= q * p * 1.05
         WHERE t <> seller ORDER BY random() LIMIT 1;
        CONTINUE WHEN buyer IS NULL;
        PERFORM preview.trade(seller, buyer, syms[i], q, p, ts);
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- SMPD: the reviewer revises the ruling to non_halal 3 days ago (buys blocked).
SELECT set_config('request.jwt.claims', '', true) \g /dev/null
-- A new ruling that changes the ruling in force carries a change reason
-- (20260926101800; harmless on databases without that migration).
SELECT set_config('app.shariah_change_reason', 'ملاحظة تجريبية: مراجعة القوائم المالية الأخيرة.', true) \g /dev/null
INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by)
VALUES ('SMPD', 'non_halal', 'ملاحظة تجريبية: تجاوزت الإيرادات غير المباحة الحد المسموح به في آخر قوائم مالية.', preview.uid('reviewer'), preview.uid('reviewer'));
SET LOCAL session_replication_role = replica;
UPDATE public.shariah_decisions SET created_at = now() - interval '3 days', updated_at = now() - interval '3 days', effective_at = now() - interval '3 days'
 WHERE symbol = 'SMPD' AND status = 'non_halal';
SET LOCAL session_replication_role = origin;

-- ----------------------------------------------------- resting order book ---
-- Current book (orders stay open): bids below and asks above the last price.
CREATE FUNCTION preview.rest(_key text, _sym text, _side text, _qty numeric, _off numeric, _age interval)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE last numeric; o uuid; st text;
BEGIN
  SELECT coalesce((SELECT price FROM public.trades WHERE symbol = _sym ORDER BY created_at DESC LIMIT 1),
                  (SELECT reference_price FROM public.brands WHERE symbol = _sym)) INTO last;
  PERFORM preview.as_service();
  SELECT m.order_id, m.status INTO o, st
    FROM public.match_order(preview.uid(_key), _sym, 'brand', _side, 'limit', _qty, round(last * (1 + _off), 2)) m;
  PERFORM preview.as_owner();
  IF st IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'resting order % % did not rest (%)', _sym, _side, st; END IF;
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.orders SET created_at = now() - _age, updated_at = now() - _age WHERE id = o;
  PERFORM set_config('session_replication_role', 'origin', true);
END $$;

DO $$
DECLARE r record; seller text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('investor2','SMPA','buy', 300, -0.012, '50 minutes'), ('investor3','SMPA','buy', 500, -0.020, '3 hours'),
      ('investor2','SMPA','buy', 150, -0.035, '1 day'),
      ('investor', 'SMPA','sell',400,  0.010, '40 minutes'), ('investor', 'SMPA','sell',250,  0.024, '2 hours'),
      ('investor2','SMPA','sell',600,  0.041, '1 day'),
      ('investor', 'SMPB','buy', 120, -0.015, '2 hours'), ('investor3','SMPB','buy', 200, -0.028, '5 hours'),
      ('investor2','SMPB','sell',180,  0.012, '1 hour'),  ('investor2','SMPB','sell',350,  0.030, '6 hours'),
      ('investor', 'SMPC','buy', 800, -0.016, '3 hours'), ('investor2','SMPC','buy',1200, -0.032, '1 day'),
      ('investor3','SMPC','sell',1000, 0.015, '2 hours'), ('investor3','SMPC','sell',2500, 0.035, '8 hours'),
      ('investor', 'SMPD','sell',300,  0.020, '2 days'),  ('investor3','SMPD','sell',150,  0.045, '1 day'),
      ('investor2','SMPE','sell',500,  0.020, '4 days'),  ('investor2','SMPE','sell',800,  0.050, '4 days'),
      ('investor', 'SMPE','buy', 200, -0.030, '3 days')
    ) v(k, sym, side, qty, off, age) LOOP
    -- A sell rests only where the investor still holds enough units.
    IF r.side = 'sell' AND coalesce((SELECT qty FROM public.positions WHERE user_id = preview.uid(r.k) AND symbol = r.sym), 0)
         < r.qty + coalesce((SELECT sum(qty - filled_qty) FROM public.orders WHERE user_id = preview.uid(r.k) AND symbol = r.sym AND side = 'sell' AND status IN ('open','partial')), 0) THEN
      CONTINUE;
    END IF;
    PERFORM preview.rest(r.k, r.sym, r.side, r.qty, r.off, r.age::interval);
  END LOOP;
END $$;

-- A partially filled bid: investor3 bids for 600 SMPA, investor sells 200 into it.
DO $$
DECLARE last numeric; o uuid; ts timestamptz := now() - interval '12 minutes';
BEGIN
  SELECT price INTO last FROM public.trades WHERE symbol = 'SMPA' ORDER BY created_at DESC LIMIT 1;
  PERFORM preview.as_service();
  SELECT m.order_id INTO o FROM public.match_order(preview.uid('investor3'), 'SMPA', 'brand', 'buy', 'limit', 600, round(last * 0.995, 2)) m;
  PERFORM public.match_order(preview.uid('investor'), 'SMPA', 'brand', 'sell', 'limit', 200, round(last * 0.995, 2));
  PERFORM preview.as_owner();
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.orders SET created_at = ts WHERE id = o;
  PERFORM set_config('session_replication_role', 'origin', true);
END $$;
-- A cancelled order in the investor's history (cancel through the engine path).
DO $$
DECLARE o uuid;
BEGIN
  PERFORM preview.as_service();
  SELECT m.order_id INTO o FROM public.match_order(preview.uid('investor'), 'SMPB', 'brand', 'buy', 'limit', 50,
    round((SELECT price FROM public.trades WHERE symbol = 'SMPB' ORDER BY created_at DESC LIMIT 1) * 0.9, 2)) m;
  PERFORM public.cancel_order(preview.uid('investor'), o);
  PERFORM preview.as_owner();
EXCEPTION WHEN undefined_function OR invalid_parameter_value THEN
  PERFORM preview.as_owner();
  RAISE NOTICE 'cancel_order signature differs; skipped the cancelled-order sample';
END $$;

-- ---------------------------------------------- on-hold investor (held) ---
INSERT INTO public.launch_review_holds (user_id, reason, detail, had_trader_role, created_at)
VALUES (preview.uid('held'), 'unexplained_cash',
        '{"note":"sample hold for the local preview","reconciliation_amount":120000,"explained_amount":100000}', true, now() - interval '10 days');

-- ------------------------------------------- invitations and access requests ---
INSERT INTO public.company_invitations (company_id, email, role, invited_by, status, expires_at, created_at) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'pending@preview.local', 'viewer', preview.uid('owner'), 'pending', now() + interval '5 days', now() - interval '2 days'),
  ('c0000000-0000-4000-8000-00000000000b', 'pending@preview.local', 'finance', preview.uid('owner2'), 'pending', now() + interval '6 days', now() - interval '1 day'),
  ('c0000000-0000-4000-8000-00000000000b', 'invitee@preview.local', 'trader', preview.uid('owner2'), 'pending', now() + interval '4 days', now() - interval '3 days'),
  ('c0000000-0000-4000-8000-00000000000a', 'investor3@preview.local', 'viewer', preview.uid('owner'), 'accepted', now() - interval '23 days', now() - interval '30 days');
UPDATE public.company_invitations SET accepted_at = now() - interval '30 days', accepted_by = preview.uid('investor3') WHERE status = 'accepted';

INSERT INTO public.access_requests (email, full_name, requested_company_id, new_company_name_ar, new_company_name_en, join_method, sector, status, created_at) VALUES
  ('applicant.search@preview.local', 'مقدم طلب تجريبي (بحث)', 'c0000000-0000-4000-8000-00000000000a', NULL, NULL, 'search', NULL, 'pending', now() - interval '1 day'),
  ('applicant.link@preview.local', 'مقدم طلب تجريبي (رابط)', 'c0000000-0000-4000-8000-00000000000b', NULL, NULL, 'link', NULL, 'pending', now() - interval '6 hours'),
  ('applicant.company@preview.local', 'مقدم طلب تجريبي (شركة جديدة)', NULL, 'شركة تجريبية ج', 'Sample Company C', 'new_company', 'food', 'pending', now() - interval '2 days');
INSERT INTO public.access_requests (email, full_name, requested_company_id, join_method, status, reviewed_by, reviewed_at, rejection_reason, created_at) VALUES
  ('applicant.old@preview.local', 'مقدم طلب تجريبي (مرفوض)', 'c0000000-0000-4000-8000-00000000000a', 'search', 'rejected', preview.uid('admin'), now() - interval '15 days', 'عينة محلية: لا تنطبق معايير الانضمام', now() - interval '16 days');
-- join_method 'investor' exists only once the investor access-request migration is applied.
DO $$ BEGIN
  INSERT INTO public.access_requests (email, full_name, join_method, status, created_at)
  VALUES ('applicant.investor@preview.local', 'مقدم طلب تجريبي (مستثمر)', 'investor', 'pending', now() - interval '3 hours');
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RAISE NOTICE 'join_method investor not supported by this schema yet; skipped the investor access request';
END $$;

-- Notification preferences and a price alert for the first investor, when the tables exist.
DO $$ BEGIN
  INSERT INTO public.symbol_watchers (user_id, symbol) VALUES (preview.uid('investor'), 'SMPB'), (preview.uid('investor'), 'SMPC');
EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation OR check_violation OR unique_violation THEN NULL;
END $$;

-- -------------------------------------------------------------- checks ---
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.portfolios p
   WHERE p.cash_balance <> (SELECT coalesce(sum(amount), 0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);
  IF bad > 0 THEN RAISE EXCEPTION 'seed invariant failed: cash <> ledger for % portfolios', bad; END IF;
  IF (SELECT coalesce(sum(amount), 0) FROM public.cash_ledger WHERE kind IN ('order_buy', 'order_sell')) <> 0 THEN
    RAISE EXCEPTION 'seed invariant failed: trade debits <> credits';
  END IF;
  WITH moves AS (
    SELECT user_id, symbol, qty FROM public.unit_issuances
    UNION ALL SELECT buyer_id, symbol, qty FROM public.trades
    UNION ALL SELECT seller_id, symbol, -qty FROM public.trades
  ), expected AS (SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2)
  SELECT count(*) INTO bad FROM expected e FULL JOIN public.positions p USING (user_id, symbol)
   WHERE coalesce(e.qty, 0) <> coalesce(p.qty, 0);
  IF bad > 0 THEN RAISE EXCEPTION 'seed invariant failed: % positions <> issued + bought - sold', bad; END IF;
  IF EXISTS (SELECT 1 FROM public.portfolios WHERE cash_balance < 0) OR EXISTS (SELECT 1 FROM public.positions WHERE qty < 0) THEN
    RAISE EXCEPTION 'seed invariant failed: negative balance or position';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE filled_qty > qty) THEN RAISE EXCEPTION 'seed invariant failed: overfilled order'; END IF;
  -- The remaining global invariants of supabase/tests/security.sh.
  IF (SELECT sum(cash_balance) FROM public.portfolios) IS DISTINCT FROM
     (SELECT sum(amount) FROM public.cash_ledger WHERE kind IN ('deposit','withdrawal','adjustment')) THEN
    RAISE EXCEPTION 'seed invariant failed: total balances <> deposits/withdrawals/adjustments';
  END IF;
  SELECT count(*) INTO bad FROM (SELECT symbol, sum(qty) q FROM public.unit_issuances GROUP BY 1) f
    FULL JOIN (SELECT symbol, sum(qty) q FROM public.positions GROUP BY 1) p USING (symbol)
   WHERE coalesce(f.q, 0) <> coalesce(p.q, 0);
  IF bad > 0 THEN RAISE EXCEPTION 'seed invariant failed: % symbols where units held <> units issued', bad; END IF;
  SELECT count(*) INTO bad FROM public.orders o
   WHERE o.filled_qty < (SELECT coalesce(sum(qty), 0) FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id);
  IF bad > 0 THEN RAISE EXCEPTION 'seed invariant failed: % orders with more traded than filled', bad; END IF;
END $$;

-- The helper schema is local tooling only: remove it.
DROP SCHEMA preview CASCADE;
COMMIT;

SELECT 'seed ok' AS status,
       (SELECT count(*) FROM public.trades) AS trades,
       (SELECT count(*) FROM public.orders WHERE status IN ('open','partial')) AS resting_orders,
       (SELECT min(created_at)::date FROM public.trades) AS first_trade_day,
       (SELECT count(*) FROM public.trades WHERE created_at > now() - interval '24 hours') AS trades_24h;
