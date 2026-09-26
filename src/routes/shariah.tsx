import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { PageHeader, HeaderLink } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FreeText } from "@/components/free-text";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeletonBlock } from "@/components/luxury-skeleton";
import { useI18n, pick, type Key } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { SITE, canonicalUrl } from "@/lib/config/site";
import { getPublicShariahRulings } from "@/lib/market/public-market.functions";
import { ShieldCheck, FileText, Scale, Ban, History, Search, BookOpen } from "lucide-react";

export const Route = createFileRoute("/shariah")({
  head: () => ({
    meta: [
      { title: "الحوكمة الشرعية — وحدة القيمة | Shariah Governance — Value Unit" },
      {
        name: "description",
        content:
          "كيف تُراجَع الإدراجات شرعيًا في وحدة القيمة، والحكم الساري لكل أداة وسببه وتاريخ سريانه. · How listings are reviewed on Value Unit and the ruling in force for each instrument.",
      },
      { property: "og:title", content: "Shariah Governance — Value Unit" },
      {
        property: "og:description",
        content: "How listings are reviewed on Value Unit, and the ruling in force for each instrument with its reason and date.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl("/shariah") },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/shariah") }],
  }),
  component: ShariahPage,
});

type RulingStatus = "halal" | "non_halal" | "reviewing";
type StatusFilter = "all" | RulingStatus;

const STATUS_META: Record<RulingStatus, { label: Key; desc: Key; cls: string }> = {
  halal: {
    label: "shariahStatusHalal",
    desc: "shariahStatusHalalDesc",
    cls: "border-state-approved/40 text-state-approved bg-state-approved/8",
  },
  reviewing: {
    label: "shariahStatusReviewing",
    desc: "shariahStatusReviewingDesc",
    cls: "border-state-pending/40 text-state-pending bg-state-pending/8",
  },
  non_halal: {
    label: "shariahStatusNonHalal",
    desc: "shariahStatusNonHalalDesc",
    cls: "border-state-rejected/40 text-state-rejected bg-state-rejected/8",
  },
};

function RulingBadge({ status }: { status: RulingStatus }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-label ${meta.cls}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {t(meta.label)}
    </span>
  );
}

function ShariahPage() {
  const { t } = useI18n();
  const { isReviewer } = useMyRoles();

  const steps: Array<{ icon: typeof FileText; title: Key; desc: Key }> = [
    { icon: FileText, title: "shariahStep1Title", desc: "shariahStep1Desc" },
    { icon: Scale, title: "shariahStep2Title", desc: "shariahStep2Desc" },
    { icon: ShieldCheck, title: "shariahStep3Title", desc: "shariahStep3Desc" },
    { icon: Ban, title: "shariahStep4Title", desc: "shariahStep4Desc" },
  ];

  return (
    <AppShell>
      <PageHeader
        title={t("aboutBoard")}
        description={t("aboutBoardDesc")}
        crumbs={[{ label: t("aboutBoard") }]}
        actions={
          <>
            <HeaderLink to="/legal/shariah-disclosures">
              <BookOpen className="h-3.5 w-3.5" /> {t("legalShariahDisclosures")}
            </HeaderLink>
            {isReviewer && (
              <HeaderLink to="/shariah/review" variant="primary">
                <ShieldCheck className="h-3.5 w-3.5" /> {t("shariahReview")}
              </HeaderLink>
            )}
          </>
        }
      />

      <section aria-labelledby="shariah-process" className="mb-10">
        <h2 id="shariah-process" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shariahProcessTitle")}
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-border/60 bg-card/60 p-5">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--gold)]/30 bg-[var(--gold-soft)] text-ink">
                  <s.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="font-mono text-xs text-[var(--gold-deep)]">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="text-sm font-semibold text-foreground">{t(s.title)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(s.desc)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="shariah-statuses" className="mb-10">
        <h2 id="shariah-statuses" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shariahStatusTitle")}
        </h2>
        <dl className="grid gap-3 md:grid-cols-3">
          {(Object.keys(STATUS_META) as RulingStatus[]).map((s) => (
            <div key={s} className="rounded-xl border border-border/60 bg-card/60 p-4">
              <dt>
                <RulingBadge status={s} />
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(STATUS_META[s].desc)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <RulingsSection />

      {SITE.shariahBoard.length > 0 && <BoardSection />}

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
            {t("shariahRecordsTitle")}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("shariahRecordsDesc")}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Scale className="h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
            {t("shariahLimitsTitle")}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("shariahLimitsDesc")}</p>
          <Link
            to="/legal/shariah-disclosures"
            className="mt-3 inline-block text-sm font-semibold text-[var(--gold-deep)] underline underline-offset-2"
          >
            {t("shariahReadDisclosures")}
          </Link>
        </div>
      </section>
    </AppShell>
  );
}

function RulingsSection() {
  const { t, lang } = useI18n();
  const fetchRulings = useServerFn(getPublicShariahRulings);
  const q = useQuery({
    queryKey: ["public-shariah-rulings"],
    queryFn: () => fetchRulings(),
    staleTime: 60_000,
  });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [term, setTerm] = useState("");

  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!needle ||
          r.symbol.toLowerCase().includes(needle) ||
          r.nameAr.toLowerCase().includes(needle) ||
          r.nameEn.toLowerCase().includes(needle)),
    );
  }, [rows, filter, term]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
        dateStyle: "medium",
      }),
    [lang],
  );
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
  };

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: "all", label: t("all") },
    { id: "halal", label: t("shariahStatusHalal") },
    { id: "reviewing", label: t("shariahStatusReviewing") },
    { id: "non_halal", label: t("shariahStatusNonHalal") },
  ];

  return (
    <section aria-labelledby="shariah-rulings">
      <div className="mb-4">
        <h2 id="shariah-rulings" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shariahRulingsTitle")}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{t("shariahRulingsSub")}</p>
      </div>

      {q.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <LuxurySkeletonBlock key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState description={t("loadFailed")} reset={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
          title={t("shariahRulingsEmptyTitle")}
          description={t("shariahRulingsEmptyDesc")}
          action={
            <Link
              to="/request-access"
              className="inline-flex min-h-10 items-center rounded-md gold-gradient px-4 text-xs font-semibold text-ink"
            >
              {t("requestAccess")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label={t("shariahStatus")} className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${
                    filter === f.id
                      ? "border-[var(--gold-deep)] bg-[var(--gold-soft)] text-[var(--gold-ink)]"
                      : "border-border text-ink-soft hover:border-[var(--gold-deep)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="relative block sm:w-64">
              <span className="sr-only">{t("shariahSearchPlaceholder")}</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t("shariahSearchPlaceholder")}
                className="min-h-9 w-full rounded-md border border-border bg-background ps-8 pe-3 text-sm"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
              {t("shariahRulingsNoMatch")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
              <div className="hidden grid-cols-[minmax(0,1.2fr)_auto_minmax(0,2fr)_auto] gap-4 border-b border-border/60 bg-muted/30 px-4 py-2 text-label text-muted-foreground md:grid">
                <span>{t("shariahColInstrument")}</span>
                <span>{t("shariahColRuling")}</span>
                <span>{t("shariahColReason")}</span>
                <span className="text-end">{t("shariahColEffective")}</span>
              </div>
              <ul>
                {filtered.map((r) => (
                  <li
                    key={r.symbol}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b border-border/40 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,2fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <Link
                        to="/market/$slug"
                        params={{ slug: r.slug }}
                        className="block truncate text-sm font-semibold text-foreground hover:text-[var(--gold-deep)]"
                      >
                        {pick(lang, r.nameAr, r.nameEn)}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                        {r.symbol}
                      </div>
                    </div>
                    <div className="justify-self-end md:justify-self-start">
                      <RulingBadge status={r.status} />
                    </div>
                    <p className="col-span-2 min-w-0 text-sm leading-relaxed text-ink-soft md:col-span-1">
                      {r.reason?.trim() ? <FreeText text={r.reason} /> : <span className="text-muted-foreground">{t("shariahNoReason")}</span>}
                    </p>
                    <div className="col-span-2 text-xs text-muted-foreground md:col-span-1 md:text-end">
                      <span className="md:hidden">{t("shariahColEffective")}: </span>
                      <time dateTime={r.effectiveAt}>{fmtDate(r.effectiveAt)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BoardSection() {
  const { t, lang } = useI18n();
  return (
    <section aria-labelledby="shariah-board" className="mt-10">
      <h2 id="shariah-board" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t("shariahBoardTitle")}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SITE.shariahBoard.map((m) => {
          const name = pick(lang, m.nameAr, m.nameEn);
          return (
            <li key={m.nameEn || m.nameAr} className="rounded-xl border border-border/60 bg-card/60 p-5">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-full gold-gradient text-base font-bold text-ink" aria-hidden>
                {name.trim().charAt(0)}
              </div>
              <div className="font-semibold text-foreground">{name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{pick(lang, m.roleAr, m.roleEn)}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
