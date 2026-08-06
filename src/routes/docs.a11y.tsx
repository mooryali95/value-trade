import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DotsThreeVertical, Trash } from "@phosphor-icons/react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LiveRegion, TableStatus } from "@/components/live-region";
import { SortHeader, Pager, comparator, clampPage, type SortDir } from "@/components/data-table-controls";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/docs/a11y")({
  head: () => ({
    meta: [
      { title: "أنماط الوصولية التفاعلية — وحدة القيمة | A11y Patterns" },
      {
        name: "description",
        content:
          "أمثلة حيّة على Dialog وDropdown وEmptyState وErrorState وDataTable مع سيناريوهات لوحة المفاتيح وaria-live.",
      },
      { property: "og:title", content: "Accessibility Patterns — Value Unit" },
      {
        property: "og:description",
        content: "Live Dialog, Dropdown, EmptyState, ErrorState and DataTable examples with keyboard and aria-live scenarios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: A11yDocsPage,
});

function Section({
  id,
  title,
  keyboard,
  children,
}: {
  id: string;
  title: string;
  keyboard: string[];
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="rounded-xl border border-border/60 bg-card p-5">
      <h2 id={`${id}-h`} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {keyboard.map((k) => (
          <li
            key={k}
            className="rounded border border-border/70 bg-background px-2 py-0.5 font-mono text-[11px] text-ink-soft"
          >
            {k}
          </li>
        ))}
      </ul>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DialogDemo() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const confirm = useConfirm();
  const [outcome, setOutcome] = React.useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button className="min-h-11 rounded-md gold-gradient px-4 text-xs font-semibold text-ink">
            Open dialog
          </button>
        </DialogTrigger>
        <DialogContent data-testid="demo-dialog">
          <DialogHeader>
            <DialogTitle>Rename brand</DialogTitle>
            <DialogDescription>
              Focus is trapped here, Escape closes and returns focus to the trigger.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="demo-name" className="text-xs font-medium text-ink-soft">
            Brand name
          </label>
          <input
            id="demo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 rounded-md border border-border bg-background px-3 text-sm text-ink"
          />
          <button
            onClick={() => {
              setOutcome(`Saved: ${name || "(empty)"}`);
              setOpen(false);
            }}
            className="min-h-11 rounded-md gold-gradient px-4 text-xs font-semibold text-ink"
          >
            Save
          </button>
        </DialogContent>
      </Dialog>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: "Delete brand?",
            description: "This cannot be undone.",
            tone: "danger",
          });
          setOutcome(ok ? "Destructive action confirmed" : "Destructive action cancelled");
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-4 text-xs font-semibold text-ink-soft"
      >
        <Trash size={14} aria-hidden />
        Destructive confirm
      </button>
      <p className="text-xs text-muted-foreground" data-testid="dialog-outcome-text">
        {outcome || "—"}
      </p>
      <LiveRegion assertive message={outcome} />
    </div>
  );
}

function DropdownDemo() {
  const [picked, setPicked] = React.useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Row actions"
            className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-ink-soft"
          >
            <DotsThreeVertical size={16} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPicked("Edit")}>Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicked("Duplicate")}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicked("Archive")}>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs text-muted-foreground" data-testid="dropdown-outcome-text">
        {picked || "—"}
      </p>
      <LiveRegion message={picked ? `${picked} selected` : ""} />
    </div>
  );
}

const ROWS = [
  { symbol: "ARAMCO", price: 28.4, change: 1.2 },
  { symbol: "SABIC", price: 74.1, change: -0.8 },
  { symbol: "ALRAJHI", price: 91.6, change: 0.4 },
  { symbol: "STC", price: 42.2, change: -1.6 },
  { symbol: "MAADEN", price: 55.9, change: 2.1 },
  { symbol: "ALINMA", price: 33.7, change: 0.9 },
];

function DataTableDemo() {
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ key: "symbol" | "price"; dir: SortDir }>({
    key: "symbol",
    dir: "asc",
  });
  const [page, setPage] = React.useState(1);
  const pageSize = 3;

  const filtered = React.useMemo(() => {
    const cmp = comparator(sort.dir);
    return ROWS.filter((r) => r.symbol.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) =>
      cmp(a[sort.key], b[sort.key]),
    );
  }, [q, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = clampPage(page, pageCount);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);

  const toggle = (key: "symbol" | "price") =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <input
          aria-label="Filter by symbol"
          data-testid="table-filter"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Filter…"
          className="min-h-11 rounded-md border border-border bg-background px-3 text-sm text-ink"
        />
      </div>
      {rows.length === 0 ? (
        <div className="p-3">
          <EmptyState
            title="No matching symbols"
            description="Your filter excluded every row. Clear it to see all symbols again."
            action={
              <button
                onClick={() => setQ("")}
                className="min-h-11 rounded-md border border-border px-4 text-xs font-semibold text-ink-soft"
              >
                Clear filters
              </button>
            }
          />
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">Demo market table with sortable columns</caption>
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">
                  <SortHeader active={sort.key === "symbol"} dir={sort.dir} onClick={() => toggle("symbol")}>
                    Symbol
                  </SortHeader>
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  <SortHeader active={sort.key === "price"} dir={sort.dir} align="end" onClick={() => toggle("price")}>
                    Price
                  </SortHeader>
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-t border-border/40">
                  <th scope="row" className="px-4 py-2 text-start font-medium text-ink">
                    {r.symbol}
                  </th>
                  <td className="px-4 py-2 text-end tabular-nums text-ink-soft">{r.price.toFixed(2)}</td>
                  <td className="px-4 py-2 text-end">
                    <button
                      aria-label={`Actions for ${r.symbol}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-ink-soft"
                    >
                      <DotsThreeVertical size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={current}
            pageCount={pageCount}
            onPage={setPage}
            labels={{ page: "Page", of: "of", prev: "Previous", next: "Next" }}
          />
        </>
      )}
      <TableStatus
        count={filtered.length}
        sortLabel={sort.key === "symbol" ? "Symbol" : "Price"}
        sortDir={sort.dir}
        labels={{ results: "results", sortedBy: "sorted by", asc: "ascending", desc: "descending" }}
      />
    </div>
  );
}

function SubmitDemo() {
  const [status, setStatus] = React.useState("");
  const [qty, setQty] = React.useState(10);
  const price = 28.4;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setStatus(qty > 0 ? `Order accepted — ${qty} units` : "Order rejected — quantity must be positive");
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div>
        <label htmlFor="demo-qty" className="block text-xs font-medium text-ink-soft">
          Quantity
        </label>
        <input
          id="demo-qty"
          type="number"
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="min-h-11 w-28 rounded-md border border-border bg-background px-3 text-sm text-ink"
        />
      </div>
      <dl
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="order-summary"
        className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs text-ink-soft"
      >
        <dt className="inline">Estimated total:&nbsp;</dt>
        <dd className="inline font-semibold text-ink">{(qty * price).toFixed(2)} SAR</dd>
      </dl>
      <button type="submit" className="min-h-11 rounded-md gold-gradient px-4 text-xs font-semibold text-ink">
        Submit order
      </button>
      <p data-testid="submit-outcome" className="text-xs text-muted-foreground">
        {status || "—"}
      </p>
      <LiveRegion assertive message={status} />
    </form>
  );
}

function A11yDocsPage() {
  const { lang } = useI18n();
  return (
    <AppShell>
      <PageHeader
        eyebrow={lang === "ar" ? "توثيق" : "Docs"}
        title={lang === "ar" ? "أنماط الوصولية التفاعلية" : "Interactive accessibility patterns"}
        description={
          lang === "ar"
            ? "أمثلة حيّة للمكونات الأساسية مع سيناريوهات لوحة المفاتيح ومناطق aria-live. تُستخدم أيضاً كهدف لاختبارات CI."
            : "Live examples of the core components with keyboard scenarios and aria-live regions. Also the target of the CI a11y suites."
        }
        crumbs={[{ label: lang === "ar" ? "الرئيسية" : "Home", to: "/" }, { label: "A11y" }]}
      />
      <div className="grid gap-4 pb-10">
        <Section id="dialog" title="Dialog / AlertDialog" keyboard={["Tab", "Shift+Tab", "Enter", "Escape"]}>
          <DialogDemo />
        </Section>
        <Section id="dropdown" title="DropdownMenu" keyboard={["Enter", "ArrowDown", "ArrowUp", "Escape"]}>
          <DropdownDemo />
        </Section>
        <Section id="datatable" title="DataTable (sort, filter, pagination)" keyboard={["Tab", "Enter", "Space"]}>
          <DataTableDemo />
        </Section>
        <Section id="live" title="Order summary + submit result (aria-live)" keyboard={["Tab", "Enter"]}>
          <SubmitDemo />
        </Section>
        <Section id="empty" title="EmptyState" keyboard={["Tab", "Enter"]}>
          <EmptyState
            title="No positions yet"
            description="Place your first order from the market to see positions here."
            action={
              <a
                href="/market"
                className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 text-xs font-semibold text-ink"
              >
                Browse market
              </a>
            }
          />
        </Section>
        <Section id="error" title="ErrorState" keyboard={["Tab", "Enter"]}>
          <ErrorState
            title="Could not load positions"
            description="The request failed. Try again, or head back home if it keeps happening."
          />
        </Section>
      </div>
    </AppShell>
  );
}