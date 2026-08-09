import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton, LuxurySkeletonBlock } from "@/components/luxury-skeleton";
import { LiveRegion } from "@/components/live-region";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/docs/states")({
  head: () => ({
    meta: [
      { title: "حالات الواجهة: فارغ وخطأ وتحميل — وحدة القيمة | UI States" },
      {
        name: "description",
        content:
          "مرجع بصري لحالات الواجهة الفارغة والأخطاء والتحميل، مُختبر تحت التباين العالي وتقليل الحركة على الهاتف والايباد.",
      },
      { property: "og:title", content: "UI States — Value Unit" },
      {
        property: "og:description",
        content:
          "Visual reference for empty, error and loading states, verified under high contrast and reduced motion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: StatesDocsPage,
});

function Case({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-state-case={id}
      aria-labelledby={`${id}-h`}
      className="rounded-xl border border-border/60 bg-card p-5"
    >
      <h2 id={`${id}-h`} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadingCase() {
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    setMessage("Loading positions…");
  }, []);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <LuxurySkeletonBlock className="h-20" />
        <LuxurySkeletonBlock className="h-20" />
        <LuxurySkeletonBlock className="h-20" />
      </div>
      <LuxurySkeleton lines={4} />
      <p className="text-xs text-muted-foreground">
        Loading placeholders keep layout stable; text below explains the wait so the state is never
        colour-only.
      </p>
      <LiveRegion message={message} />
    </div>
  );
}

function StatesDocsPage() {
  const { lang } = useI18n();
  return (
    <AppShell>
      <PageHeader
        eyebrow={lang === "ar" ? "توثيق" : "Docs"}
        title={lang === "ar" ? "حالات الواجهة" : "Interface states"}
        description={
          lang === "ar"
            ? "مرجع بصري لحالات الفراغ والخطأ والتحميل. يُستخدم هدفاً للقطات الانحدار البصري تحت التباين العالي وتقليل الحركة."
            : "Visual reference for empty, error and loading states. Target of the visual-regression snapshots under high contrast and reduced motion."
        }
        crumbs={[
          { label: lang === "ar" ? "الرئيسية" : "Home", to: "/" },
          { label: lang === "ar" ? "الحالات" : "States" },
        ]}
      />
      <div className="grid gap-4 pb-10">
        <Case id="empty-basic" title="EmptyState — no data yet">
          <EmptyState
            title="No positions yet"
            description="Place your first order from the market and your positions will appear here with live valuation."
            action={
              <a
                href="/market"
                className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 text-xs font-semibold text-ink"
              >
                Browse market
              </a>
            }
          />
        </Case>
        <Case id="empty-filtered" title="EmptyState — filters exclude everything">
          <EmptyState
            title="No matching results"
            description="Your current filter combination excluded every row. Clear the filters to see the full list again."
            action={
              <button className="min-h-11 rounded-md border border-border px-4 text-xs font-semibold text-ink-soft">
                Clear filters
              </button>
            }
          />
        </Case>
        <Case id="error-load" title="ErrorState — request failed">
          <ErrorState
            title="Could not load positions"
            description="The request failed before it reached the server. Try again, or head back home if the problem keeps happening."
          />
        </Case>
        <Case id="loading" title="Loading — skeletons + announcement">
          <LoadingCase />
        </Case>
      </div>
    </AppShell>
  );
}