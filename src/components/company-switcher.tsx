import { useState, useRef, useEffect } from "react";
import { CaretDown, Buildings, Check } from "@phosphor-icons/react";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";

export function CompanySwitcher() {
  const { lang, t } = useI18n();
  const { companies, active, setActive } = useActiveCompany();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!companies.length) {
    return (
      <Link
        to="/company/settings"
        className="hidden items-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] md:inline-flex"
      >
        <Buildings size={14} weight="duotone" />
        {t("createCompany") ?? "Create company"}
      </Link>
    );
  }

  const label = active ? (lang === "ar" ? active.name_ar : active.name_en) : "—";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-semibold text-ink transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
      >
        <Buildings size={14} weight="duotone" />
        <span className="max-w-[120px] truncate">{label}</span>
        <CaretDown size={12} weight="bold" />
      </button>
      {open && (
        <div className="absolute end-0 mt-2 w-64 rounded-lg border border-border bg-card p-1 shadow-lg z-50">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
            {t("company") ?? "Company"}
          </div>
          {companies.map((c) => {
            const isActive = c.id === active?.id;
            return (
              <button
                key={c.id}
                onClick={() => { setActive(c.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-[13px] transition ${
                  isActive ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]" : "text-ink hover:bg-secondary/70"
                }`}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{lang === "ar" ? c.name_ar : c.name_en}</span>
                  <span className="truncate text-[10px] uppercase tracking-[0.14em] text-ink-soft">{c.role} · {c.plan ?? "free"}</span>
                </div>
                {isActive && <Check size={14} weight="bold" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-border/60" />
          <Link
            to="/company/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] text-ink-soft hover:bg-secondary/70"
          >
            <Buildings size={12} weight="regular" />
            {t("companySettings") ?? "Company settings"}
          </Link>
        </div>
      )}
    </div>
  );
}