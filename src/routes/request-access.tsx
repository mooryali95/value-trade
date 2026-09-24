import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useI18n, type Key } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { BrandMark } from "@/components/brand-mark";
import {
  searchCompaniesPublic,
  getCompanyBySlugPublic,
  submitAccessRequest,
  checkAccessRequestStatus,
} from "@/lib/access/access-requests.functions";
import { normalizeReference } from "@/lib/access/reference";
import {
  Loader2,
  Mail,
  User as UserIcon,
  Search,
  Building2,
  CheckCircle2,
  Copy,
  Check,
  TrendingUp,
  Users,
  Landmark,
} from "lucide-react";

const searchSchema = z.object({
  slug: z.string().max(48).optional().catch(undefined),
  ref: z.string().max(64).optional().catch(undefined),
  kind: z.enum(["invest", "join", "new"]).optional().catch(undefined),
});

export const Route = createFileRoute("/request-access")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "طلب انضمام — وحدة القيمة | Request access — Value Unit" },
      {
        name: "description",
        content:
          "اطلب الانضمام إلى وحدة القيمة مستثمرًا أو عضوًا في شركة مسجّلة أو بتسجيل شركة جديدة. · Request access to Value Unit as an investor, a company member or a new company.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RequestAccessPage,
});

type CompanyLite = { id: string; slug: string; name_ar: string; name_en: string };
type Kind = "invest" | "join" | "new";

const KIND_OPTIONS: Array<{ kind: Kind; icon: typeof TrendingUp; title: Key; desc: Key }> = [
  { kind: "invest", icon: TrendingUp, title: "r_raKindInvest", desc: "r_raKindInvestDesc" },
  { kind: "join", icon: Users, title: "joinExistingCompany", desc: "r_raKindJoinDesc" },
  { kind: "new", icon: Landmark, title: "registerNewCompany", desc: "r_raKindNewDesc" },
];

const NEXT_STEPS: Record<Kind, Key> = {
  invest: "r_raNextInvest",
  join: "r_raNextJoin",
  new: "r_raNextNew",
};

function RequestAccessPage() {
  const { t, lang, dir } = useI18n();
  const errorMessage = useErrorMessage();
  const search = useSearch({ from: "/request-access" }) as { slug?: string; ref?: string; kind?: Kind };

  const [kind, setKind] = useState<Kind>(search.slug ? "join" : (search.kind ?? "invest"));
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyLite[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<CompanyLite | null>(null);
  const [joinMethod, setJoinMethod] = useState<"search" | "link">("search");
  const [newNameAr, setNewNameAr] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ referenceCode: string; emailSent: boolean; kind: Kind } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showStatusCheck, setShowStatusCheck] = useState(!!search.ref);

  const searchFn = useServerFn(searchCompaniesPublic);
  const bySlugFn = useServerFn(getCompanyBySlugPublic);
  const submitFn = useServerFn(submitAccessRequest);

  // Pre-fill from a direct company link: /join/acme -> /request-access?slug=acme
  useEffect(() => {
    if (!search.slug || !/^[a-z0-9-]{1,48}$/.test(search.slug)) return;
    bySlugFn({ data: { slug: search.slug } })
      .then((c) => {
        if (c) {
          setSelected(c as CompanyLite);
          setJoinMethod("link");
          setKind("join");
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.slug]);

  // Debounced company search (typeahead)
  useEffect(() => {
    if (kind !== "join" || joinMethod === "link" || query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const handle = setTimeout(() => {
      searchFn({ data: { query: query.trim() } })
        .then((rows) => {
          setResults(rows as unknown as CompanyLite[]);
          setSearched(true);
        })
        .catch(() => {
          setResults([]);
          setSearched(true);
        });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, joinMethod, kind]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (kind === "join") {
        if (!selected) throw new Error("SELECT_COMPANY");
        return submitFn({
          data: { join_method: joinMethod, email, full_name: fullName, requested_company_id: selected.id },
        });
      }
      if (kind === "new") {
        return submitFn({
          data: {
            join_method: "new_company",
            email,
            full_name: fullName,
            new_company_name_ar: newNameAr,
            new_company_name_en: newNameEn,
          },
        });
      }
      return submitFn({ data: { join_method: "investor", email, full_name: fullName } });
    },
    onSuccess: (result) => {
      setSubmitted({ referenceCode: result.referenceCode, emailSent: result.emailSent, kind });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "ERROR";
      setError(msg === "RATE_LIMITED" ? t("requestRateLimited") : msg === "SELECT_COMPANY" ? t("r_raSelectCompany") : errorMessage(e, undefined, "r_raSubmitFailed"));
    },
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    emailValid &&
    fullName.trim().length > 0 &&
    (kind === "join" ? !!selected : kind === "new" ? newNameAr.trim().length > 0 && newNameEn.trim().length > 0 : true);

  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden ivory-gradient lg:flex lg:flex-col lg:justify-between lg:p-12">
          <Link to="/" className="flex items-center gap-3 w-fit">
            <BrandMark size={44} />
            <div>
              <div className="text-lg font-bold tracking-wide text-ink">{t("brand")}</div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-deep)]">Value Unit</div>
            </div>
          </Link>
          <div className="max-w-md">
            <div className="mb-4 h-px w-24 hairline-gold" />
            <h1 className="text-3xl font-bold leading-tight text-ink md:text-4xl">{t("requestAccessTitle")}</h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("r_raIntro")}</p>
            <ol className="mt-6 space-y-2 text-sm text-ink-soft">
              <li>1. {t("r_raStep1")}</li>
              <li>2. {t("r_raStep2")}</li>
              <li>3. {t("r_raStep3")}</li>
            </ol>
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            © {new Date().getFullYear()} · {t("brand")}
          </div>
        </aside>

        <main className="flex items-center justify-center bg-background px-4 py-10 sm:px-6">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link to="/" className="flex items-center gap-3">
                <BrandMark size={40} />
                <span className="text-lg font-bold text-ink">{t("brand")}</span>
              </Link>
            </div>

            {submitted ? (
              <div className="rounded-lg border border-[var(--bull)]/40 bg-[var(--bull)]/5 p-6 text-center" role="status">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[var(--bull)]" aria-hidden />
                <p className="text-sm font-semibold text-ink">{t("r_raSubmittedTitle")}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t(NEXT_STEPS[submitted.kind])}</p>
                <div className="mt-4">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("r_raReference")}</div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(submitted.referenceCode).catch(() => undefined);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    aria-label={t("r_raCopyReference")}
                    className="mx-auto flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm font-semibold tracking-wider text-ink hover:border-[var(--gold-deep)]"
                    dir="ltr"
                  >
                    {submitted.referenceCode}
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-[var(--bull)]" aria-hidden />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {submitted.emailSent ? t("r_raReferenceEmailed") : t("r_raReferenceKeep")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <h2 className="mb-2 text-2xl font-bold text-ink">{t("requestAccessTitle")}</h2>
                <p className="mb-5 text-xs leading-relaxed text-muted-foreground lg:hidden">{t("r_raIntro")}</p>

                <fieldset className="mb-5">
                  <legend className="mb-2 text-xs font-semibold text-ink">{t("r_raChooseKind")}</legend>
                  <div className="grid gap-2" role="radiogroup">
                    {KIND_OPTIONS.map((o) => {
                      const active = kind === o.kind;
                      const Icon = o.icon;
                      return (
                        <button
                          key={o.kind}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => {
                            setKind(o.kind);
                            setError(null);
                          }}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-start transition ${
                            active ? "border-[var(--gold-deep)] bg-[var(--gold-soft)]/60" : "border-border bg-card hover:border-[var(--gold)]/60"
                          }`}
                        >
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-[var(--gold-deep)]" : "text-muted-foreground"}`} aria-hidden />
                          <span>
                            <span className="block text-sm font-semibold text-ink">{t(o.title)}</span>
                            <span className="block text-[11px] leading-relaxed text-muted-foreground">{t(o.desc)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <form
                  className="space-y-3"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canSubmit || mutation.isPending) return;
                    setError(null);
                    mutation.mutate();
                  }}
                >
                  <Field icon={UserIcon} label={t("fullName")}>
                    <input
                      value={fullName}
                      maxLength={160}
                      autoComplete="name"
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-transparent text-sm text-ink outline-none"
                    />
                  </Field>
                  <Field icon={Mail} label={t("email")}>
                    <input
                      type="email"
                      value={email}
                      maxLength={320}
                      autoComplete="email"
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-transparent text-sm text-ink outline-none"
                      placeholder="you@company.com"
                      dir="ltr"
                    />
                  </Field>

                  {kind === "join" &&
                    (selected ? (
                      <div className="rounded-md border border-primary/40 bg-secondary/40 px-3 py-2">
                        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t("prefilledCompany")}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink">
                            {lang === "ar" ? selected.name_ar : selected.name_en}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(null);
                              setJoinMethod("search");
                            }}
                            className="text-xs text-muted-foreground underline"
                          >
                            {t("r_raChangeCompany")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <Field icon={Search} label={t("joinExistingCompany")}>
                          <input
                            value={query}
                            maxLength={80}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("searchCompanyPlaceholder")}
                            aria-autocomplete="list"
                            className="w-full bg-transparent text-sm text-ink outline-none"
                          />
                        </Field>
                        {results.length > 0 ? (
                          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md" role="listbox">
                            {results.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                role="option"
                                aria-selected={false}
                                onClick={() => {
                                  setSelected(c);
                                  setResults([]);
                                  setQuery("");
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-secondary"
                              >
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                {lang === "ar" ? c.name_ar : c.name_en}
                              </button>
                            ))}
                          </div>
                        ) : (
                          searched &&
                          query.trim().length >= 2 && (
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("r_raNoCompanyFound")}</p>
                          )
                        )}
                      </div>
                    ))}

                  {kind === "new" && (
                    <>
                      <Field icon={Building2} label={t("newCompanyNameAr")}>
                        <input
                          value={newNameAr}
                          maxLength={120}
                          onChange={(e) => setNewNameAr(e.target.value)}
                          className="w-full bg-transparent text-sm text-ink outline-none"
                          dir="rtl"
                        />
                      </Field>
                      <Field icon={Building2} label={t("newCompanyNameEn")}>
                        <input
                          value={newNameEn}
                          maxLength={120}
                          onChange={(e) => setNewNameEn(e.target.value)}
                          className="w-full bg-transparent text-sm text-ink outline-none"
                          dir="ltr"
                        />
                      </Field>
                    </>
                  )}

                  {kind === "invest" && (
                    <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                      {t("r_raInvestNote")}
                    </p>
                  )}

                  <div aria-live="polite" aria-atomic="true">
                    {error && (
                      <div role="alert" className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">
                        {error}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit || mutation.isPending}
                    className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink shadow-sm transition hover:brightness-105 disabled:opacity-60"
                  >
                    {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t("submitRequest")}
                  </button>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{t("r_raPrivacyNote")}</p>
                </form>

                <div className="mt-6 text-center text-xs text-muted-foreground">
                  {t("r_raHaveAccount")}{" "}
                  <Link to="/auth" className="font-medium text-[var(--gold-deep)] underline">
                    {t("signin")}
                  </Link>
                </div>
              </>
            )}

            <div className="mt-8 border-t border-border pt-5">
              <button
                type="button"
                onClick={() => setShowStatusCheck((v) => !v)}
                aria-expanded={showStatusCheck}
                className="text-xs font-medium text-[var(--gold-deep)] hover:underline"
              >
                {t("checkPreviousRequest")}
              </button>
              {showStatusCheck && <StatusCheckPanel initialRef={search.ref ?? submitted?.referenceCode ?? ""} />}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm transition focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {children}
      </div>
    </label>
  );
}

const STATUS_KEY: Record<string, Key> = {
  pending: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
};

const STATUS_NEXT: Record<string, Key> = {
  pending: "r_raStatusPendingNext",
  approved: "r_raStatusApprovedNext",
  rejected: "r_raStatusRejectedNext",
};

function StatusCheckPanel({ initialRef }: { initialRef: string }) {
  const { t } = useI18n();
  const statusFn = useServerFn(checkAccessRequestStatus);
  const [ref, setRef] = useState(initialRef);
  const [checkEmail, setCheckEmail] = useState("");
  const [result, setResult] = useState<
    { found: true; status: string; reviewedAt: string | null; joinMethod: string | null } | { found: false } | null
  >(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const normalized = normalizeReference(ref);

  const check = useMutation({
    mutationFn: () => statusFn({ data: { reference: normalized ?? ref.trim(), email: checkEmail.trim() } }),
    onSuccess: (r) => {
      setResult(r);
      setCheckError(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "ERROR";
      setCheckError(msg === "RATE_LIMITED" ? t("requestRateLimited") : t("statusCheckInvalid"));
      setResult(null);
    },
  });

  const statusColor =
    result?.found && result.status === "approved"
      ? "text-[var(--bull)]"
      : result?.found && result.status === "rejected"
        ? "text-[var(--bear)]"
        : "text-[var(--gold-deep)]";

  return (
    <form
      className="mt-3 space-y-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (normalized && checkEmail.trim()) check.mutate();
      }}
    >
      <label className="block text-[11px] text-muted-foreground">
        {t("r_raReference")}
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="VU-XXXX-XXXX"
          dir="ltr"
          maxLength={64}
          aria-invalid={ref.trim().length > 0 && !normalized}
          className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs uppercase outline-none focus:border-[var(--gold-deep)]"
        />
      </label>
      <label className="block text-[11px] text-muted-foreground">
        {t("email")}
        <input
          value={checkEmail}
          onChange={(e) => setCheckEmail(e.target.value)}
          type="email"
          dir="ltr"
          maxLength={320}
          className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-xs outline-none focus:border-[var(--gold-deep)]"
        />
      </label>
      {ref.trim().length > 0 && !normalized && <p className="text-[11px] text-[var(--bear)]">{t("r_raReferenceInvalid")}</p>}
      <button
        type="submit"
        disabled={!normalized || !checkEmail.trim() || check.isPending}
        className="min-h-10 w-full rounded-md border border-border bg-secondary py-2 text-xs font-semibold text-ink disabled:opacity-50"
      >
        {check.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" aria-hidden /> : t("checkStatus")}
      </button>

      <div aria-live="polite" aria-atomic="true">
        {checkError && <p className="text-[11px] text-[var(--bear)]">{checkError}</p>}
        {result &&
          (result.found ? (
            <div>
              <p className={`text-xs font-semibold ${statusColor}`}>{t(STATUS_KEY[result.status] ?? "statusPending")}</p>
              {STATUS_NEXT[result.status] && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {result.status === "approved" && result.joinMethod === "investor"
                    ? t("r_raStatusApprovedInvestorNext")
                    : t(STATUS_NEXT[result.status])}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("statusCheckNotFound")}</p>
          ))}
      </div>
    </form>
  );
}
