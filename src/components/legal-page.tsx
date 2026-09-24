import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n, type Key } from "@/lib/i18n";
import { SITE, hasEntityDetails, isFilled, siteContacts, siteText, type SiteContactKind } from "@/lib/config/site";

/** Date shown as "last updated" on every legal document. */
export const LEGAL_LAST_UPDATED = "2026-09-25";

export type LegalDoc = "terms" | "privacy" | "cookies" | "shariah" | "risk";

/**
 * `contactKinds`: a section that only lists contact addresses; it is left out
 * while none of those addresses is configured (no empty heading).
 */
export type LegalSection = { id: string; heading: string; body: ReactNode; contactKinds?: SiteContactKind[] };

type LegalPath = "/legal/terms" | "/legal/risk" | "/legal/privacy" | "/legal/cookies" | "/legal/shariah-disclosures";

const DOCS: Array<{ id: LegalDoc; to: LegalPath; label: Key }> = [
  { id: "terms", to: "/legal/terms", label: "legalTerms" },
  { id: "risk", to: "/legal/risk", label: "legalRisk" },
  { id: "privacy", to: "/legal/privacy", label: "legalPrivacy" },
  { id: "cookies", to: "/legal/cookies", label: "legalCookies" },
  { id: "shariah", to: "/legal/shariah-disclosures", label: "legalShariahDisclosures" },
];

function formatLegalDate(iso: string, lang: "ar" | "en") {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Shared layout for the legal documents: title, last-updated date, summary,
 * table of contents, numbered sections, operator block (only the SITE fields
 * that are filled) and links to the other documents.
 */
export function LegalPage({
  doc,
  title,
  summary,
  sections,
}: {
  doc: LegalDoc;
  title: string;
  summary?: ReactNode;
  sections: LegalSection[];
}) {
  const { t, lang } = useI18n();
  const shown = sections.filter((s) => !s.contactKinds || siteContacts(s.contactKinds).length > 0);
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl py-8 text-ink">
        <div className="mb-6 h-px hairline-gold" />
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("legalLastUpdated")}:{" "}
          <time dateTime={LEGAL_LAST_UPDATED}>{formatLegalDate(LEGAL_LAST_UPDATED, lang)}</time>
        </p>

        {summary && (
          <div className="mt-6 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold-soft)]/40 p-5 text-sm leading-relaxed text-ink-soft">
            {summary}
          </div>
        )}

        {shown.length > 3 && (
          <nav aria-label={t("legalOnThisPage")} className="mt-8 rounded-xl border border-border/60 bg-card/60 p-5">
            <div className="mb-2 text-label text-muted-foreground">{t("legalOnThisPage")}</div>
            <ol className="grid gap-1 text-sm sm:grid-cols-2">
              {shown.map((s, i) => (
                <li key={s.id} className="min-w-0">
                  <a href={`#${s.id}`} className="text-ink-soft hover:text-[var(--gold-deep)]">
                    {i + 1}. {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {shown.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-8 scroll-mt-24">
            <h2 id={`${s.id}-h`} className="text-lg font-semibold text-ink">
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-soft">{s.body}</div>
          </section>
        ))}

        <OperatorBlock />

        <nav aria-label={t("legalRelatedDocs")} className="mt-10 border-t border-border/60 pt-6">
          <div className="mb-3 text-label text-muted-foreground">{t("legalRelatedDocs")}</div>
          <ul className="flex flex-wrap gap-2">
            {DOCS.filter((d) => d.id !== doc).map((d) => (
              <li key={d.id}>
                <Link
                  to={d.to}
                  className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
                >
                  {t(d.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>
    </AppShell>
  );
}

/** Bulleted list with the legal pages' spacing. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 ps-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Configured contact addresses (SITE); renders nothing when none is set. */
export function LegalContacts({ kinds }: { kinds?: Parameters<typeof siteContacts>[0] }) {
  const { t } = useI18n();
  const contacts = siteContacts(kinds);
  if (contacts.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {contacts.map((c) => (
        <li key={c.kind}>
          <span className="text-muted-foreground">{t(`legalContact_${c.kind}` as Key)}: </span>
          <a href={`mailto:${c.email}`} className="font-medium text-[var(--gold-deep)] underline underline-offset-2" dir="ltr">
            {c.email}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Operator identity from SITE. Hidden entirely until at least one field is confirmed. */
function OperatorBlock() {
  const { t, lang } = useI18n();
  if (!hasEntityDetails()) return null;
  const name = siteText(lang, SITE.legalEntityNameAr, SITE.legalEntityNameEn);
  const address = siteText(lang, SITE.addressAr, SITE.addressEn);
  const licensing = siteText(lang, SITE.licensingStatusAr, SITE.licensingStatusEn);
  const rows: Array<[Key, string]> = [];
  if (name) rows.push(["legalEntityName", name]);
  if (isFilled(SITE.commercialRegistration)) rows.push(["legalCommercialRegistration", SITE.commercialRegistration.trim()]);
  if (address) rows.push(["legalAddress", address]);
  if (licensing) rows.push(["legalLicensingStatus", licensing]);
  return (
    <section aria-labelledby="operator-h" className="mt-10 rounded-xl border border-border/60 bg-card/60 p-5">
      <h2 id="operator-h" className="text-sm font-semibold text-ink">
        {t("legalOperatorHeading")}
      </h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{t(label)}</dt>
            <dd className="min-w-0 text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
