#!/usr/bin/env bash
# Builds supabase/ops/launch_bundle.sql: every migration from 20260924100000
# onward (filename order), in ONE transaction, for the owner to run once in
# the Lovable Cloud SQL editor. See supabase/ops/README.md.
#
#   bash supabase/ops/build_launch_bundle.sh            # writes the bundle
#   bash supabase/ops/build_launch_bundle.sh --check    # exit 1 if the
#                                                       # committed bundle is stale
#
# Test it with supabase/ops/test_launch_bundle.sh (production-like legacy
# database, bundle applied with ON_ERROR_STOP, sanity checks).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIG="$REPO/supabase/migrations"
OUT="$HERE/launch_bundle.sql"
FIRST="20260924100000"

mapfile -t FILES < <(cd "$MIG" && ls -1 -- *.sql | LC_ALL=C sort | awk -v f="$FIRST" '$0 >= f')
[ "${#FILES[@]}" -gt 0 ] || { echo "no migrations from $FIRST found in $MIG" >&2; exit 1; }

# A file that manages its own transaction, or needs to run outside one,
# cannot go into a single-transaction bundle.
for f in "${FILES[@]}"; do
  if grep -nEi '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;|CONCURRENTLY|^[[:space:]]*VACUUM|^[[:space:]]*\\' "$MIG/$f" \
       | grep -vE '^[0-9]+:[[:space:]]*--' >/dev/null; then
    echo "$f contains a transaction-control statement, CONCURRENTLY, VACUUM or a psql meta-command;" >&2
    echo "it cannot be bundled into one transaction. Fix the migration first." >&2
    exit 1
  fi
done

VERSIONS=""
for f in "${FILES[@]}"; do
  v="${f%%_*}"; n="${f#*_}"; n="${n%.sql}"
  VERSIONS+="    ('$v', '$n'),"$'\n'
done
VERSIONS="${VERSIONS%,$'\n'}"

build() {
  cat <<HEADER
-- ============================================================================
-- Value Unit (وحدة القيمة): LAUNCH MIGRATION BUNDLE
-- GENERATED FILE: do not edit by hand. Rebuild with
--   bash supabase/ops/build_launch_bundle.sh
-- Source: ${#FILES[@]} files of supabase/migrations, ${FILES[0]}
--         ... ${FILES[${#FILES[@]}-1]}, in filename order.
--
-- ENGLISH
-- What it is: every database change made for the launch (security lockdown,
-- matching engine, investor onboarding, exact money, submission to listing
-- lifecycle, integrity report), concatenated in order.
-- How to run: ONCE, in the Lovable Cloud SQL editor, on the production
-- database: paste the whole file and run it. It is ONE transaction: if any
-- statement fails, nothing is changed; fix the cause and run it again.
-- Before: take a backup (or confirm point-in-time recovery is on), and
-- confirm none of these migrations was already applied (the bundle stops
-- with LAUNCH_BUNDLE_ALREADY_APPLIED when the migration history says so).
-- After: the migration history (supabase_migrations.schema_migrations,
-- when present) records each version, so they are not applied twice.
-- Expect the notice LAUNCH_BUNDLE_DONE. Then follow supabase/ops/README.md
-- (smoke suite, /admin/health integrity checks, go_live_reset.sql).
--
-- العربية
-- ما هذا الملف: جميع تغييرات قاعدة البيانات الخاصة بالإطلاق (إحكام الأمان،
-- ومحرّك المطابقة، وتسجيل المستثمرين، ودقة المبالغ، ومسار الطلب حتى الإدراج،
-- وتقرير سلامة البيانات)، مجمّعة بترتيبها.
-- طريقة التشغيل: مرة واحدة فقط في محرّر SQL في Lovable Cloud على قاعدة بيانات
-- الإنتاج: الصق الملف كاملًا وشغّله. يُنفَّذ الملف معاملةً واحدة: إذا فشلت أي
-- عبارة لا يتغيّر شيء؛ عالج السبب ثم أعد التشغيل.
-- قبل التشغيل: خذ نسخة احتياطية (أو تأكّد من تفعيل الاستعادة إلى نقطة زمنية)،
-- وتأكّد أن أيًّا من هذه الترحيلات لم يُطبَّق من قبل (يتوقف الملف برسالة
-- LAUNCH_BUNDLE_ALREADY_APPLIED إذا دلّ سجل الترحيلات على ذلك).
-- بعد التشغيل: يُسجَّل كل إصدار في سجل الترحيلات
-- (supabase_migrations.schema_migrations عند وجوده) فلا يُطبَّق مرتين.
-- ينبغي أن يظهر الإشعار LAUNCH_BUNDLE_DONE، ثم اتبع supabase/ops/README.md.
-- ============================================================================

BEGIN;

-- Preconditions: the pre-launch schema is there, and this bundle has not
-- been applied already.
DO \$launch_bundle_pre\$
DECLARE
  _applied text[];
BEGIN
  IF to_regclass('public.brands') IS NULL OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.portfolios') IS NULL THEN
    RAISE EXCEPTION 'LAUNCH_BUNDLE_WRONG_DATABASE'
      USING DETAIL = 'public.brands / orders / portfolios not found: this is not the Value Unit database.';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE \$q\$
      SELECT coalesce(array_agg(version ORDER BY version), '{}')
        FROM supabase_migrations.schema_migrations
       WHERE version >= '$FIRST' AND version <= '${FILES[${#FILES[@]}-1]%%_*}'
    \$q\$ INTO _applied;
    IF cardinality(_applied) > 0 THEN
      RAISE EXCEPTION 'LAUNCH_BUNDLE_ALREADY_APPLIED'
        USING DETAIL = format('The migration history already lists %s of these versions: %s. Nothing was changed.',
                              cardinality(_applied), array_to_string(_applied, ', ')),
              HINT = 'Apply only the missing migration files instead of this bundle.';
    END IF;
  END IF;
END
\$launch_bundle_pre\$;
HEADER
  for f in "${FILES[@]}"; do
    printf '\n-- ============================================================================\n'
    printf -- '-- >>> %s\n' "$f"
    printf -- '-- ============================================================================\n'
    # Each migration ran as its own transaction; reset transaction-local
    # settings a previous file may have left (search_path is the one that
    # matters for unqualified names).
    printf 'SET LOCAL search_path = public, extensions;\n'
    cat "$MIG/$f"
    printf '\n'
  done
  cat <<FOOTER

-- ============================================================================
-- Record the versions in the migration history (when the table exists) and
-- report.
-- ============================================================================
SET LOCAL search_path = public, extensions;
DO \$launch_bundle_post\$
DECLARE
  _has_name boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
                      AND column_name = 'name') INTO _has_name;
    IF _has_name THEN
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      SELECT v.version, v.name FROM (VALUES
$VERSIONS
      ) AS v(version, name)
      ON CONFLICT (version) DO NOTHING;
    ELSE
      INSERT INTO supabase_migrations.schema_migrations (version)
      SELECT v.version FROM (VALUES
$VERSIONS
      ) AS v(version, name)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  END IF;
  RAISE NOTICE 'LAUNCH_BUNDLE_DONE files=${#FILES[@]} first=${FILES[0]%%_*} last=${FILES[${#FILES[@]}-1]%%_*}';
END
\$launch_bundle_post\$;

COMMIT;
FOOTER
}

if [ "${1:-}" == "--check" ]; then
  if [ -f "$OUT" ] && diff -q <(build) "$OUT" >/dev/null; then echo "launch_bundle.sql is up to date"; exit 0; fi
  echo "launch_bundle.sql is missing or stale: run bash supabase/ops/build_launch_bundle.sh" >&2
  exit 1
fi
build >"$OUT"
echo "wrote $OUT (${#FILES[@]} migrations, $(wc -c <"$OUT") bytes)"
