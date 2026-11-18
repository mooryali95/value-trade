import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MagnifyingGlass, UserCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badge";
import { LiveRegion } from "@/components/live-region";
import { useConfirm } from "@/components/confirm-dialog";
import { useI18n, type Key } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatCurrency } from "@/lib/format";
import {
  findInvestorByEmail,
  getInvestorLedger,
  listPendingActivations,
  setTraderRole,
  type InvestorSummary,
  type PendingActivation,
} from "@/lib/admin/investors.functions";
import { resendInvestorInvitation } from "@/lib/access/access-requests.functions";
import { appRoleKey } from "@/lib/tenants/role-labels";
import { Num } from "@/components/num";
import { fill } from "@/lib/account/fill";
import { formatDay, formatDayTime } from "@/lib/account/dates";
import { adjustCash } from "@/lib/trading/cash.functions";
import {
  issueUnits,
  listAdminInstruments,
  setInstrumentPublished,
  setReferencePrice,
  type AdminInstrument,
} from "@/lib/admin/listing.functions";
import { validatePrice, validateQty } from "@/components/order-outcome";
import { isValidReferencePrice } from "@/lib/trading/calc";

export const Route = createFileRoute("/_authenticated/admin/investors")({
  head: () => ({
    meta: [
      { property: "og:title", content: "المستثمرون — وحدة القيمة | Investors — Value Unit" },
      { property: "og:description", content: "تفعيل المستثمرين المدعوين للتداول وتمويل حساباتهم. · Activate invited investors and fund their accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "المستثمرون — وحدة القيمة | Investors — Value Unit" },
      { name: "description", content: "تفعيل المستثمرين المدعوين للتداول وتمويل حساباتهم. · Activate invited investors and fund their accounts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: AdminInvestorsPage,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CASH_AMOUNT = 1_000_000_000;

/** Amount > 0, at most 1,000,000,000, with at most 2 decimals. */
function validateAmount(v: string): boolean {
  const s = v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return false;
  const n = Number(s);
  return n > 0 && n <= MAX_CASH_AMOUNT;
}

const SYMBOL_RE = /^[A-Za-z0-9._-]{1,32}$/;

const KIND_LABEL: Record<string, Key> = {
  deposit: "cashKindDeposit",
  withdrawal: "cashKindWithdrawal",
  order_buy: "cashKindOrderBuy",
  order_sell: "cashKindOrderSell",
  adjustment: "cashKindAdjustment",
};

function AdminInvestorsPage() {
  const { t } = useI18n();
  const { isAdmin, isLoading: rolesLoading } = useMyRoles();
  // The email lives in component state only (not the URL) so it does not
  // end up in browser history or access logs.
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const findFn = useServerFn(findInvestorByEmail);
  const errorMessage = useErrorMessage();

  const inputValid = EMAIL_RE.test(input.trim());
  const query = useQuery({
    queryKey: ["admin-investor", email],
    queryFn: () => findFn({ data: { email } }),
    enabled: !rolesLoading && isAdmin && email.length > 0,
    retry: false,
  });

  if (!rolesLoading && !isAdmin) {
    return (
      <AppShell>
        <div className="py-16">
          <AccessDenied />
        </div>
      </AppShell>
    );
  }

  const submit = () => {
    setTouched(true);
    if (!inputValid) return;
    setEmail(input.trim().toLowerCase());
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("nav_investors")}
        description={t("investorsDesc")}
        crumbs={[{ label: t("modePlatform"), to: "/admin/companies" }, { label: t("nav_investors") }]}
      />

      {!rolesLoading && isAdmin && (
        <PendingActivationsCard
          onOpen={(address) => {
            setInput(address);
            setTouched(false);
            setEmail(address);
          }}
        />
      )}

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("r_invFindTitle")}</h2>
      <form
        className="mb-6 flex max-w-xl flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <div className="min-w-[240px] flex-1">
          <label htmlFor="investor-email" className="sr-only">
            {t("email")}
          </label>
          <div className="relative">
            <MagnifyingGlass
              size={15}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground start-3"
            />
            <input
              id="investor-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("investorSearchPlaceholder")}
              aria-invalid={touched && !inputValid}
              aria-describedby={touched && !inputValid ? "investor-email-error" : undefined}
              className="w-full rounded-md border border-input bg-card py-2 text-sm outline-none focus:border-[var(--gold-deep)] ps-9 pe-3"
            />
          </div>
          {touched && !inputValid && (
            <p id="investor-email-error" className="mt-1 text-xs text-[var(--bear)]">
              {t("investorEmailInvalid")}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={rolesLoading || query.isFetching}
          className="min-h-10 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {query.isFetching ? t("loading") : t("investorSearch")}
        </button>
      </form>

      {rolesLoading || (email && query.isLoading) ? (
        <LuxurySkeleton lines={6} />
      ) : !email ? (
        <EmptyState
          title={t("nav_investors")}
          description={t("investorSearchPrompt")}
          icon={<UserCircle size={22} weight="duotone" />}
        />
      ) : query.isError ? (
        <div className="py-10">
          <ErrorState description={errorMessage(query.error)} reset={() => query.refetch()} />
        </div>
      ) : !query.data ? (
        <EmptyState title={t("investorNotFound")} description={t("investorNotFoundDesc")} />
      ) : (
        <InvestorPanel investor={query.data} email={email} />
      )}

      {!rolesLoading && isAdmin && <ReferencePriceCard />}
      {!rolesLoading && isAdmin && <InstrumentListingCard />}
    </AppShell>
  );
}

/** Listing reference price of an instrument (anchors the band until the first close). */
function ReferencePriceCard() {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const setRefFn = useServerFn(setReferencePrice);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [touched, setTouched] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const symbolValid = SYMBOL_RE.test(symbol.trim());
  // A reference price runs from 0.05 to 1,000,000,000 on the 0.01 tick
  // (the database enforces the same rule).
  const priceError: Key | null =
    price.trim() !== "" && !validatePrice(price) && isValidReferencePrice(Number(price.trim()))
      ? null
      : "fx3_errReferencePriceRange";

  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (v: { symbol: string; price: number }) => setRefFn({ data: v }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-instruments"] });
      qc.invalidateQueries({ queryKey: ["market-overview"] });
      const msg = t("referencePriceSet")
        .replace("{symbol}", res.symbol)
        .replace("{price}", formatCurrency(res.referencePrice, false, lang));
      toast.success(msg);
      setAnnouncement(msg);
      setPrice("");
      setTouched(false);
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e, { INVALID_PRICE: "fx3_errReferencePriceRange" });
      toast.error(msg);
      setAnnouncement(msg);
    },
  });

  const submit = async () => {
    setTouched(true);
    if (!symbolValid || priceError) return;
    const sym = symbol.trim().toUpperCase();
    const value = Number(price.trim());
    const ok = await confirm({
      title: t("setReferencePrice"),
      description: `${sym} — ${formatCurrency(value, false, lang)}. ${t("listingDesc")}`,
      confirmLabel: t("setReferencePrice"),
      cancelLabel: t("cancel"),
    });
    if (ok) mut.mutate({ symbol: sym, price: value });
  };

  return (
    <section className="mt-6 max-w-xl rounded-xl border border-border/60 bg-card p-4">
      <LiveRegion message={announcement} />
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("listingTitle")}</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("listingDesc")}</p>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <label className="block text-[11px] text-muted-foreground">
          {t("brandSymbol")}
          <input
            dir="ltr"
            value={symbol}
            maxLength={32}
            onChange={(e) => setSymbol(e.target.value)}
            aria-invalid={touched && !symbolValid}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[var(--gold-deep)]"
          />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          {t("referencePrice")}
          <input
            type="number"
            inputMode="decimal"
            min="0.05"
            step="0.01"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={touched && !!priceError}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-end font-mono text-sm outline-none focus:border-[var(--gold-deep)]"
          />
        </label>
        <button
          type="submit"
          disabled={mut.isPending}
          className="min-h-10 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {mut.isPending ? t("loading") : t("setReferencePrice")}
        </button>
      </form>
      {touched && (!symbolValid || priceError) && (
        <p className="mt-2 text-xs text-[var(--bear)]">{!symbolValid ? t("symbolInvalid") : t(priceError!)}</p>
      )}
    </section>
  );
}

type ListingFilter = "all" | "published" | "unpublished";

/**
 * Publish / unpublish instruments. Only published instruments appear on the
 * public market and accept orders; unpublishing closes the instrument's
 * resting orders (holders keep their units). Publishing needs a positive
 * reference price.
 */
function InstrumentListingCard() {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const listFn = useServerFn(listAdminInstruments);
  const publishFn = useServerFn(setInstrumentPublished);
  const [q, setQ] = useState("");
  // Listed instruments first; the legacy demo instruments of the early
  // builds (no company, no submission) are hidden unless asked for.
  const [filter, setFilter] = useState<ListingFilter>("published");
  const [showSeeded, setShowSeeded] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const list = useQuery({ queryKey: ["admin-instruments"], queryFn: () => listFn() });

  const mut = useMutation({
    mutationFn: (v: { symbol: string; published: boolean }) => publishFn({ data: v }),
    onSuccess: (res) => {
      const msg = (res.published ? t("e2_publishedToast") : t("e2_unpublishedToast"))
        .replace("{symbol}", res.symbol)
        .replace("{n}", String(res.cancelledOrders));
      toast.success(msg);
      setAnnouncement(msg);
      qc.invalidateQueries({ queryKey: ["admin-instruments"] });
      qc.invalidateQueries({ queryKey: ["market-overview"] });
      qc.invalidateQueries({ queryKey: ["book"] });
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e, { INVALID_PRICE: "e2_publishNeedsPrice", SHARIAH_RULING_REQUIRED: "fx_publishNeedsRuling" });
      toast.error(msg);
      setAnnouncement(msg);
    },
  });

  const toggle = async (i: AdminInstrument) => {
    const publish = !i.published;
    // No reference price yet (0 = not set): nothing to confirm.
    if (publish && !(i.referencePrice > 0)) {
      const msg = t("e2_publishNeedsPrice");
      toast.error(msg);
      setAnnouncement(msg);
      return;
    }
    const ok = await confirm({
      title: publish ? t("e2_publishConfirmTitle") : t("e2_unpublishConfirmTitle"),
      description: `${i.symbol} — ${lang === "ar" ? i.nameAr : i.nameEn}. ${
        publish
          ? t("e2_publishConfirmDesc").replace("{price}", formatCurrency(i.referencePrice, false, lang)) +
            (i.origin === "demo_seed" ? ` ${t("fx_publishDemoWarning")}` : "")
          : t("e2_unpublishConfirmDesc")
      }`,
      confirmLabel: publish ? t("e2_publish") : t("e2_unpublish"),
      cancelLabel: t("cancel"),
      tone: publish ? "default" : "danger",
    });
    if (ok) mut.mutate({ symbol: i.symbol, published: publish });
  };

  const all = list.data ?? [];
  const seededCount = all.filter((i) => i.origin === "demo_seed" && !i.published).length;
  // A listed seeded instrument stays visible (it must be delistable).
  const rows = showSeeded ? all : all.filter((i) => i.origin !== "demo_seed" || i.published);
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((i) => {
    if (filter === "published" && !i.published) return false;
    if (filter === "unpublished" && i.published) return false;
    if (!needle) return true;
    return i.symbol.toLowerCase().includes(needle) || i.nameEn.toLowerCase().includes(needle) || i.nameAr.includes(q.trim());
  });
  const shown = filtered.slice(0, 100);
  const publishedCount = rows.filter((i) => i.published).length;
  const originLabel = (o: AdminInstrument["origin"]) =>
    o === "submission" ? t("e2_originSubmission") : o === "company" ? t("e2_originCompany") : t("e2_originDemo");

  return (
    <section className="mt-6 rounded-xl border border-border/60 bg-card p-4">
      <LiveRegion message={announcement} />
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("e2_publishTitle")}</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("e2_publishDesc")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("e2_searchInstruments")}
          aria-label={t("e2_searchInstruments")}
          className="min-w-[200px] flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-[var(--gold-deep)]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ListingFilter)}
          aria-label={t("filterStatus")}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        >
          <option value="all">{t("filterAll")}</option>
          <option value="published">{t("e2_published")}</option>
          <option value="unpublished">{t("e2_unpublished")}</option>
        </select>
        {seededCount > 0 && (
          <label className="inline-flex min-h-9 items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={showSeeded} onChange={(e) => setShowSeeded(e.target.checked)} />
            {t("d_showSeeded")}
          </label>
        )}
        {list.data && (
          <span className="text-[11px] text-muted-foreground">
            {t("e2_publishedCount").replace("{n}", String(publishedCount)).replace("{total}", String(rows.length))}
          </span>
        )}
      </div>
      {list.isLoading ? (
        <LuxurySkeleton lines={5} />
      ) : list.isError ? (
        <ErrorState description={errorMessage(list.error)} reset={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t("e2_noInstrumentsAdmin")}</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t("emptyTitle")}</p>
      ) : (
        <div>
          <table className="w-full text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-start font-semibold">{t("e2_colInstrument")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("e2_origin")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("referencePrice")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("filterStatus")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="max-md:block">
              {shown.map((i) => (
                <tr key={i.symbol} className="border-b border-border/40 last:border-0 max-md:block max-md:py-2">
                  <td className="px-3 py-2 max-md:block max-md:pb-1">
                    <div className="font-mono text-xs font-semibold text-ink"><span dir="ltr">{i.symbol}</span></div>
                    <div className="max-w-[260px] truncate text-[11px] text-muted-foreground max-md:max-w-none max-md:whitespace-normal">{lang === "ar" ? i.nameAr : i.nameEn}</div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-soft max-md:inline-block max-md:py-1">{originLabel(i.origin)}</td>
                  <td className="px-3 py-2 text-end font-mono text-xs max-md:inline-block max-md:py-1" dir="ltr">
                    {i.referencePrice > 0 ? formatCurrency(i.referencePrice, false, lang) : "—"}
                  </td>
                  <td className="px-3 py-2 max-md:inline-block max-md:py-1">
                    <span className="whitespace-nowrap">
                      <Badge variant={i.published ? "bull" : "neutral"}>{i.published ? t("e2_published") : t("e2_unpublished")}</Badge>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end max-md:block max-md:pt-1 max-md:text-start">
                    <button
                      type="button"
                      onClick={() => void toggle(i)}
                      disabled={mut.isPending}
                      className={`min-h-9 rounded border px-3 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                        i.published
                          ? "border-[var(--bear)]/40 text-[var(--bear)] hover:bg-[var(--bear)]/5"
                          : "border-[var(--gold-deep)]/40 text-[var(--gold-deep)] hover:bg-[var(--gold-soft)]"
                      }`}
                    >
                      {i.published ? t("e2_unpublish") : t("e2_publish")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > shown.length && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              {t("e2_reviewPoolMore").replace("{n}", String(filtered.length - shown.length))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function InvestorPanel({ investor, email }: { investor: InvestorSummary; email: string }) {
  const { t, lang, dir } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const ledgerFn = useServerFn(getInvestorLedger);
  const setRoleFn = useServerFn(setTraderRole);
  const adjustFn = useServerFn(adjustCash);
  const issueFn = useServerFn(issueUnits);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const ledger = useQuery({
    queryKey: ["admin-investor-ledger", investor.userId],
    queryFn: () => ledgerFn({ data: { userId: investor.userId } }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-investor", email] });
    qc.invalidateQueries({ queryKey: ["admin-investor-ledger", investor.userId] });
    qc.invalidateQueries({ queryKey: ["admin-pending-activations"] });
  };

  const roleMut = useMutation({
    mutationFn: (active: boolean) => setRoleFn({ data: { userId: investor.userId, active } }),
    onSuccess: (res) => {
      const msg = res.tradingActive
        ? t("tradingActivated")
        : t("tradingDeactivatedOrders").replace("{n}", String(res.cancelledOrders));
      toast.success(msg);
      setAnnouncement(msg);
      refresh();
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e);
      toast.error(msg);
      setAnnouncement(msg);
    },
  });

  const cashMut = useMutation({
    mutationFn: (v: { kind: "deposit" | "withdrawal"; amount: number; note?: string }) =>
      adjustFn({ data: { userId: investor.userId, ...v } }),
    onSuccess: (res) => {
      const msg = t("cashPosted").replace("{balance}", formatCurrency(Number(res.balance), false, lang));
      toast.success(msg);
      setAnnouncement(msg);
      setAmount("");
      setNote("");
      setAmountTouched(false);
      refresh();
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e);
      toast.error(msg);
      setAnnouncement(msg);
      refresh();
    },
  });

  const [unitSymbol, setUnitSymbol] = useState("");
  const [unitQty, setUnitQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitNote, setUnitNote] = useState("");
  const [unitsTouched, setUnitsTouched] = useState(false);
  const unitSymbolValid = SYMBOL_RE.test(unitSymbol.trim());
  const unitQtyError = validateQty(unitQty);
  const unitPriceError = validatePrice(unitPrice);
  const unitsError: Key | null = !unitSymbolValid
    ? "symbolInvalid"
    : unitQtyError
      ? "unitsQtyInvalid"
      : unitPriceError;

  const issueMut = useMutation({
    mutationFn: (v: { symbol: string; qty: number; price: number; note?: string }) =>
      issueFn({ data: { userId: investor.userId, ...v } }),
    onSuccess: (res) => {
      const msg = t("unitsIssued").replace("{qty}", String(res.qty)).replace("{symbol}", res.symbol);
      toast.success(msg);
      setAnnouncement(msg);
      setUnitQty("");
      setUnitNote("");
      setUnitsTouched(false);
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e);
      toast.error(msg);
      setAnnouncement(msg);
    },
  });

  const allocate = async () => {
    setUnitsTouched(true);
    if (unitsError) return;
    const sym = unitSymbol.trim().toUpperCase();
    const qty = Number(unitQty.trim());
    const price = Number(unitPrice.trim());
    const ok = await confirm({
      title: t("confirmIssueUnitsTitle"),
      description: t("confirmIssueUnitsDesc")
        .replace("{qty}", String(qty))
        .replace("{symbol}", sym)
        .replace("{price}", formatCurrency(price, false, lang))
        .replace("{email}", investor.email),
      confirmLabel: t("issueUnits"),
      cancelLabel: t("cancel"),
    });
    if (ok) issueMut.mutate({ symbol: sym, qty, price, note: unitNote.trim() || undefined });
  };

  const amountValid = validateAmount(amount);
  const cashBalance = ledger.data?.cashBalance ?? investor.cashBalance;

  const toggleTrading = async () => {
    const activate = !investor.tradingActive;
    const ok = await confirm({
      title: activate ? t("activateTrading") : t("deactivateTrading"),
      description: `${investor.email} — ${activate ? t("activateTradingConfirm") : t("deactivateTradingConfirm")}`,
      confirmLabel: activate ? t("activateTrading") : t("deactivateTrading"),
      cancelLabel: t("cancel"),
      tone: activate ? "default" : "danger",
    });
    if (ok) roleMut.mutate(activate);
  };

  const postCash = async (kind: "deposit" | "withdrawal") => {
    setAmountTouched(true);
    if (!amountValid) return;
    const value = Number(amount.trim());
    const formatted = formatCurrency(value, false, lang);
    const ok = await confirm({
      title: kind === "deposit" ? t("confirmDepositTitle") : t("confirmWithdrawTitle"),
      description: t("confirmCashDesc").replace("{amount}", formatted).replace("{email}", investor.email),
      confirmLabel: kind === "deposit" ? t("cashDeposit") : t("cashWithdraw"),
      cancelLabel: t("cancel"),
      tone: kind === "withdrawal" ? "danger" : "default",
    });
    if (ok) cashMut.mutate({ kind, amount: value, note: note.trim() || undefined });
  };

  const fmtDate = (iso: string | null) => formatDayTime(iso, lang) || "—";

  return (
    <div dir={dir} className="space-y-4">
      <LiveRegion message={announcement} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Profile */}
        <section className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("investorProfile")}
          </h2>
          <div className="text-base font-semibold text-ink">{investor.fullName || "—"}</div>
          <div className="truncate text-sm text-ink-soft" dir="ltr">
            {investor.email}
          </div>
          {!investor.emailConfirmed && (
            <div className="mt-1">
              <Badge variant="bear">{t("emailUnconfirmed")}</Badge>
            </div>
          )}
          {investor.reviewHolds.length > 0 && (
            <div className="mt-2">
              <Badge variant="bear">{t("reviewHoldBadge")}</Badge>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("reviewHoldHint")}</p>
            </div>
          )}
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("memberSince")}</dt>
              <dd className="text-ink">{fmtDate(investor.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("lastSignIn")}</dt>
              <dd className="text-ink">{fmtDate(investor.lastSignInAt)}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <div className="mb-1 text-[11px] text-muted-foreground">{t("appRoles")}</div>
            <div className="flex flex-wrap gap-1">
              {investor.roles.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t("noRoles")}</span>
              ) : (
                investor.roles.map((r) => {
                  const k = appRoleKey(r);
                  return (
                    <Badge key={r} variant={r === "trader" ? "bull" : "neutral"}>
                      {k ? t(k) : <span dir="ltr">{r}</span>}
                    </Badge>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Trading access */}
        <section className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("tradingStatus")}
          </h2>
          <Badge variant={investor.tradingActive ? "bull" : "neutral"}>
            {investor.tradingActive ? t("tradingActive") : t("tradingInactive")}
          </Badge>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("tradingStatusHint")}</p>
          <button
            onClick={toggleTrading}
            disabled={roleMut.isPending}
            className={
              investor.tradingActive
                ? "mt-4 min-h-10 w-full rounded-md border border-[var(--bear)]/40 px-4 text-sm font-semibold text-[var(--bear)] disabled:opacity-50"
                : "mt-4 min-h-10 w-full rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
            }
          >
            {roleMut.isPending ? t("loading") : investor.tradingActive ? t("deactivateTrading") : t("activateTrading")}
          </button>
        </section>

        {/* Cash */}
        <section className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("currentCash")}
          </h2>
          <div className="font-mono text-xl font-semibold text-ink">
            {formatCurrency(cashBalance, false, lang)}{" "}
            <span className="text-xs text-muted-foreground">{investor.currency}</span>
          </div>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void postCash("deposit");
            }}
            noValidate
          >
            <label className="block text-[11px] text-muted-foreground">
              {t("amount")}
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                max={MAX_CASH_AMOUNT}
                step="0.01"
                dir="ltr"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={amountTouched && !amountValid}
                aria-describedby={amountTouched && !amountValid ? "cash-amount-error" : undefined}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-end font-mono text-sm outline-none focus:border-[var(--gold-deep)]"
              />
            </label>
            {amountTouched && !amountValid && (
              <p id="cash-amount-error" className="text-xs text-[var(--bear)]">
                {t("cashAmountInvalid")}
              </p>
            )}
            <label className="block text-[11px] text-muted-foreground">
              {t("cashNoteOptional")}
              <input
                value={note}
                maxLength={280}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-[var(--gold-deep)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="submit"
                disabled={cashMut.isPending}
                className="min-h-10 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 text-sm font-semibold text-[var(--bull)] disabled:opacity-50"
              >
                {t("cashDeposit")}
              </button>
              <button
                type="button"
                onClick={() => void postCash("withdrawal")}
                disabled={cashMut.isPending}
                className="min-h-10 rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 text-sm font-semibold text-[var(--bear)] disabled:opacity-50"
              >
                {t("cashWithdraw")}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Primary allocation of brand units */}
      <section className="rounded-xl border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("issueUnitsTitle")}
        </h2>
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void allocate();
          }}
          noValidate
        >
          <label className="block text-[11px] text-muted-foreground">
            {t("brandSymbol")}
            <input
              dir="ltr"
              value={unitSymbol}
              maxLength={32}
              onChange={(e) => setUnitSymbol(e.target.value)}
              aria-invalid={unitsTouched && !unitSymbolValid}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[var(--gold-deep)]"
            />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            {t("qty")}
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="10000000"
              step="1"
              dir="ltr"
              value={unitQty}
              onChange={(e) => setUnitQty(e.target.value)}
              aria-invalid={unitsTouched && !!unitQtyError}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-end font-mono text-sm outline-none focus:border-[var(--gold-deep)]"
            />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            {t("issuePrice")}
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              dir="ltr"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              aria-invalid={unitsTouched && !!unitPriceError}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-end font-mono text-sm outline-none focus:border-[var(--gold-deep)]"
            />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            {t("cashNoteOptional")}
            <input
              value={unitNote}
              maxLength={280}
              onChange={(e) => setUnitNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-[var(--gold-deep)]"
            />
          </label>
          <button
            type="submit"
            disabled={issueMut.isPending}
            className="min-h-10 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {issueMut.isPending ? t("loading") : t("issueUnits")}
          </button>
        </form>
        {unitsTouched && unitsError && <p className="mt-2 text-xs text-[var(--bear)]">{t(unitsError)}</p>}
      </section>

      {/* Ledger */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <h2 className="border-b border-border/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("recentCashMovements")}
        </h2>
        {ledger.isLoading ? (
          <div className="p-4">
            <LuxurySkeleton lines={4} />
          </div>
        ) : ledger.isError ? (
          <div className="py-8">
            <ErrorState description={errorMessage(ledger.error)} reset={() => ledger.refetch()} />
          </div>
        ) : (ledger.data?.rows ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("noCashMovements")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 text-start font-semibold">{t("createdAt")}</th>
                  <th className="px-4 py-2 text-start font-semibold">{t("cashMovementType")}</th>
                  <th className="px-4 py-2 text-end font-semibold">{t("amount")}</th>
                  <th className="px-4 py-2 text-end font-semibold">{t("balanceAfter")}</th>
                  <th className="px-4 py-2 text-start font-semibold">{t("cashNote")}</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data?.rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2 text-xs text-ink">{KIND_LABEL[r.kind] ? t(KIND_LABEL[r.kind]) : r.kind}</td>
                    <td
                      className={`px-4 py-2 text-end font-mono text-xs ${r.amount >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}
                      dir="ltr"
                    >
                      {r.amount > 0 ? "+" : ""}
                      {formatCurrency(r.amount, false, lang)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs text-ink" dir="ltr">
                      {formatCurrency(r.balance_after, false, lang)}
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-2 text-xs text-ink-soft">{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const SOURCE_KEY: Record<PendingActivation["source"], Key> = {
  investor_request: "r_invSourceInvestorRequest",
  invited_no_account: "r_invSourceInvitedNoAccount",
  no_role: "r_invSourceNoRole",
  no_role_never_signed_in: "fx3_srcNoRoleNeverSignedIn",
};

/**
 * Accounts waiting for trading activation: approved investors (with or
 * without an account yet) and people who signed in without any role or
 * company. Activation grants the trader role; funding is a deposit posted
 * from the investor panel below.
 */
function PendingActivationsCard({ onOpen }: { onOpen: (email: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const listFn = useServerFn(listPendingActivations);
  const setRoleFn = useServerFn(setTraderRole);
  const resendFn = useServerFn(resendInvestorInvitation);
  const [announcement, setAnnouncement] = useState("");
  const q = useQuery({ queryKey: ["admin-pending-activations"], queryFn: () => listFn() });

  const say = (msg: string, ok = true) => {
    setAnnouncement(msg);
    if (ok) toast.success(msg);
    else toast.error(msg);
  };

  const activate = useMutation({
    mutationFn: (row: PendingActivation) => setRoleFn({ data: { userId: row.userId!, active: true } }),
    onSuccess: (_res, row) => {
      say(t("r_invActivatedFund"));
      qc.invalidateQueries({ queryKey: ["admin-pending-activations"] });
      qc.invalidateQueries({ queryKey: ["admin-investor"] });
      onOpen(row.email);
    },
    onError: (e: unknown) => say(errorMessage(e), false),
  });

  const resend = useMutation({
    mutationFn: (requestId: string) => resendFn({ data: { requestId } }),
    onSuccess: (res) => say(res.notification.sent ? t("r_arApprovedInvestorSent") : t("r_arApprovedEmailFailed"), res.notification.sent),
    onError: (e: unknown) => say(errorMessage(e), false),
  });

  const fmt = (iso: string | null) =>
    formatDay(iso, lang) || "—";
  const rows = q.data ?? [];

  return (
    <section className="mb-8 rounded-xl border border-border/60 bg-card">
      <LiveRegion message={announcement} />
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{t("r_invPendingTitle")}</h2>
        {q.data && (
          <span className="text-[11px] text-muted-foreground">
            {fill(t("r_invPendingCount"), { n: <Num value={rows.length} kind="qty" /> })}
          </span>
        )}
      </div>
      <p className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground">{t("r_invPendingDesc")}</p>
      {q.isLoading ? (
        <div className="p-4">
          <LuxurySkeleton lines={3} />
        </div>
      ) : q.isError ? (
        <div className="py-6">
          <ErrorState description={errorMessage(q.error)} reset={() => q.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("r_invPendingEmpty")}</p>
      ) : (
        <div className="p-2">
          {/* Below md each row is a card: applicant, source, date, then the actions. */}
          <table className="w-full text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-start font-semibold">{t("r_arColApplicant")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("r_invColSource")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("createdAt")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="max-md:block">
              {rows.map((r) => (
                <tr key={`${r.userId ?? "none"}:${r.email}`} className="border-b border-border/40 align-top last:border-0 max-md:block max-md:py-2">
                  <td className="px-3 py-2 max-md:block max-md:pb-1">
                    <div className="break-words text-xs font-semibold text-ink">{r.fullName || "—"}</div>
                    <div className="break-all text-[11px] text-muted-foreground" dir="ltr">{r.email}</div>
                    {r.requestReference && (
                      <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.requestReference}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 max-md:inline-block max-md:py-1">
                    <span className="whitespace-nowrap">
                      <Badge variant={r.source === "invited_no_account" ? "neutral" : "gold"}>{t(SOURCE_KEY[r.source] ?? "r_invSourceNoRole")}</Badge>
                    </span>
                    {r.userId && !r.emailConfirmed && (
                      <div className="mt-1">
                        <Badge variant="bear">{t("emailUnconfirmed")}</Badge>
                      </div>
                    )}
                    {r.onHold && (
                      <div className="mt-1">
                        <Badge variant="bear">{t("r_invOnHold")}</Badge>
                        <p className="mt-0.5 max-w-[16rem] text-[10px] leading-relaxed text-muted-foreground">{t("r_invOnHoldHint")}</p>
                      </div>
                    )}
                    {r.pendingCompanyInvitations > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {fill(t("r_invPendingCompanyInvites"), { n: <Num value={r.pendingCompanyInvitations} kind="qty" /> })}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-muted-foreground max-md:inline-block max-md:py-1">{fmt(r.requestedAt ?? r.createdAt)}</td>
                  <td className="px-3 py-2 max-md:block max-md:pt-1">
                    <div className="flex flex-wrap justify-end gap-1.5 max-md:justify-start">
                      {r.requestId && (!r.userId || !r.emailConfirmed) && (
                        <button
                          type="button"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(r.requestId!)}
                          className="min-h-9 rounded border border-border px-2 py-1 text-[11px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-50"
                        >
                          {t("r_arResendPlatformInvite")}
                        </button>
                      )}
                      {r.userId && (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpen(r.email)}
                            className="min-h-9 rounded border border-border px-2 py-1 text-[11px] text-ink-soft hover:border-[var(--gold-deep)]"
                          >
                            {t("r_invOpen")}
                          </button>
                          {!r.onHold && (
                          <button
                            type="button"
                            disabled={activate.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: t("activateTrading"),
                                description: `${r.email} — ${t("activateTradingConfirm")}`,
                                confirmLabel: t("activateTrading"),
                                cancelLabel: t("cancel"),
                              });
                              if (ok) activate.mutate(r);
                            }}
                            className="min-h-9 rounded gold-gradient px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
                          >
                            {t("activateTrading")}
                          </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
