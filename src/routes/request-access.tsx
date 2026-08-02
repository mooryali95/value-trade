import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { BrandMark } from "@/components/brand-mark";
import {
  searchCompaniesPublic,
  getCompanyBySlugPublic,
  submitAccessRequest,
} from "@/lib/access/access-requests.functions";
import { Loader2, Mail, User as UserIcon, Search, Building2, CheckCircle2 } from "lucide-react";

const searchSchema = z.object({ slug: z.string().optional() });

export const Route = createFileRoute("/request-access")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "طلب انضمام — وحدة القيمة | Request access — Value Unit" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RequestAccessPage,
});

type CompanyLite = { id: string; slug: string; name_ar: string; name_en: string };

function RequestAccessPage() {
  const { t, lang, dir } = useI18n();
  const search = useSearch({ from: "/request-access" }) as { slug?: string };

  const [tab, setTab] = useState<"join" | "new">("join");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyLite[]>([]);
  const [selected, setSelected] = useState<CompanyLite | null>(null);
  const [joinMethod, setJoinMethod] = useState<"search" | "link">("search");
  const [newNameAr, setNewNameAr] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const searchFn = useServerFn(searchCompaniesPublic);
  const bySlugFn = useServerFn(getCompanyBySlugPublic);
  const submitFn = useServerFn(submitAccessRequest);

  // Pre-fill from a direct company link: /request-access?slug=acme
  useEffect(() => {
    if (!search.slug) return;
    bySlugFn({ data: { slug: search.slug } }).then((c) => {
      if (c) {
        setSelected(c as CompanyLite);
        setJoinMethod("link");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.slug]);

  // Debounced company search (typeahead)
  useEffect(() => {
    if (joinMethod === "link" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      searchFn({ data: { query: query.trim() } })
        .then((rows) => setResults(rows as unknown as CompanyLite[]))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, joinMethod]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (tab === "join") {
        if (!selected) throw new Error("SELECT_COMPANY");
        return submitFn({
          data: {
            join_method: joinMethod,
            email,
            full_name: fullName,
            requested_company_id: selected.id,
          },
        });
      }
      return submitFn({
        data: {
          join_method: "new_company",
          email,
          full_name: fullName,
          new_company_name_ar: newNameAr,
          new_company_name_en: newNameEn,
        },
      });
    },
    onSuccess: () => setDone(true),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "ERROR";
      setError(
        msg === "RATE_LIMITED" ? t("requestRateLimited") : msg === "SELECT_COMPANY" ? null : msg,
      );
    },
  });

  const canSubmit =
    email.trim().length > 3 &&
    fullName.trim().length > 0 &&
    (tab === "join" ? !!selected : newNameAr.trim().length > 0 && newNameEn.trim().length > 0);

  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden ivory-gradient lg:flex lg:flex-col lg:justify-between lg:p-12">
          <Link to="/" className="flex items-center gap-3 w-fit">
            <BrandMark size={44} />
            <div>
              <div className="text-lg font-bold tracking-wide text-ink">{t("brand")}</div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--gold-deep)]">
                Value Unit
              </div>
            </div>
          </Link>
          <div className="max-w-md">
            <div className="mb-4 h-px w-24 hairline-gold" />
            <h1 className="text-3xl font-bold leading-tight text-ink md:text-4xl">
              {t("requestAccessTitle")}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t("requestAccessDesc")}
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            © {new Date().getFullYear()} · {t("brand")}
          </div>
        </aside>

        <main className="flex items-center justify-center bg-background px-6 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link to="/" className="flex items-center gap-3">
                <BrandMark size={40} />
                <span className="text-lg font-bold text-ink">{t("brand")}</span>
              </Link>
            </div>

            {done ? (
              <div className="rounded-lg border border-[var(--bull)]/40 bg-[var(--bull)]/5 p-6 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[var(--bull)]" />
                <p className="text-sm text-ink">{t("requestSubmitted")}</p>
              </div>
            ) : (
              <>
                <h2 className="mb-6 text-2xl font-bold text-ink">{t("requestAccessTitle")}</h2>

                <div className="mb-5 grid grid-cols-2 rounded-lg border border-border bg-card p-1 text-sm font-medium">
                  <button
                    onClick={() => setTab("join")}
                    className={`rounded-md py-2 transition ${tab === "join" ? "bg-secondary text-ink" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t("joinExistingCompany")}
                  </button>
                  <button
                    onClick={() => setTab("new")}
                    className={`rounded-md py-2 transition ${tab === "new" ? "bg-secondary text-ink" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t("registerNewCompany")}
                  </button>
                </div>

                <div className="space-y-3">
                  <Field icon={UserIcon} label={t("fullName")}>
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-transparent text-sm text-ink outline-none"
                    />
                  </Field>
                  <Field icon={Mail} label={t("email")}>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-transparent text-sm text-ink outline-none"
                      placeholder="you@company.com"
                    />
                  </Field>

                  {tab === "join" ? (
                    selected ? (
                      <div className="rounded-md border border-primary/40 bg-secondary/40 px-3 py-2">
                        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t("prefilledCompany")}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink">
                            {lang === "ar" ? selected.name_ar : selected.name_en}
                          </span>
                          <button
                            onClick={() => {
                              setSelected(null);
                              setJoinMethod("search");
                            }}
                            className="text-xs text-muted-foreground underline"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <Field icon={Search} label={t("joinExistingCompany")}>
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("searchCompanyPlaceholder")}
                            className="w-full bg-transparent text-sm text-ink outline-none"
                          />
                        </Field>
                        {results.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md">
                            {results.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => {
                                  setSelected(c);
                                  setResults([]);
                                  setQuery("");
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-secondary"
                              >
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                {lang === "ar" ? c.name_ar : c.name_en}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    <>
                      <Field icon={Building2} label={t("newCompanyNameAr")}>
                        <input
                          value={newNameAr}
                          onChange={(e) => setNewNameAr(e.target.value)}
                          className="w-full bg-transparent text-sm text-ink outline-none"
                          dir="rtl"
                        />
                      </Field>
                      <Field icon={Building2} label={t("newCompanyNameEn")}>
                        <input
                          value={newNameEn}
                          onChange={(e) => setNewNameEn(e.target.value)}
                          className="w-full bg-transparent text-sm text-ink outline-none"
                          dir="ltr"
                        />
                      </Field>
                    </>
                  )}

                  {error && (
                    <div className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">
                      {error}
                    </div>
                  )}

                  <button
                    disabled={!canSubmit || mutation.isPending}
                    onClick={() => {
                      setError(null);
                      mutation.mutate();
                    }}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md gold-gradient py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:brightness-105 disabled:opacity-60"
                  >
                    {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("submitRequest")}
                  </button>
                </div>

                <div className="mt-6 text-center text-xs text-muted-foreground">
                  <Link to="/auth" className="underline">
                    {t("signin")}
                  </Link>
                </div>
              </>
            )}
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
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm transition focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {children}
      </div>
    </label>
  );
}
