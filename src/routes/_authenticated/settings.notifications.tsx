import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notifications/preferences.functions";
import { listMyWatchers, addWatcher, removeWatcher } from "@/lib/notifications/watchers.functions";
import { Trash, Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { assetClassLabel } from "@/components/market-data";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({
    meta: [
      { property: "og:title", content: "تفضيلات الإشعارات · Notification preferences — Value Unit" },
      { property: "og:description", content: "تحكم في أنواع رسائل البريد التي تصلك من وحدة القيمة." },
      { title: "تفضيلات الإشعارات · Notification preferences — Value Unit" },
      { name: "description", content: "تحكم في أنواع رسائل البريد التي تصلك من وحدة القيمة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationsSettings,
});

function NotificationsSettings() {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const getPrefs = useServerFn(getMyNotificationPreferences);
  const savePrefs = useServerFn(updateMyNotificationPreferences);
  const listW = useServerFn(listMyWatchers);
  const addW = useServerFn(addWatcher);
  const rmW = useServerFn(removeWatcher);

  const prefsQ = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getPrefs() });
  const watchersQ = useQuery({ queryKey: ["watchers"], queryFn: () => listW() });

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (prefsQ.data) setPrefs(prefsQ.data);
  }, [prefsQ.data]);

  const save = useMutation({
    mutationFn: (p: NotificationPreferences) => savePrefs({ data: p }),
    onSuccess: () => {
      toast.success(t("u_nfSaved"));
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    },
  });
  const addM = useMutation({
    mutationFn: (symbol: string) => addW({ data: { symbol, asset_class: "brand" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchers"] }),
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const rmM = useMutation({
    mutationFn: (symbol: string) => rmW({ data: { symbol } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchers"] }),
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const [newSym, setNewSym] = useState("");

  const toggle = (k: keyof NotificationPreferences) => {
    if (!prefs) return;
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    save.mutate(next);
  };

  const watchers = watchersQ.data ?? [];

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("nav_settings")}
        title={t("u_nfTitle")}
        description={t("u_nfDesc")}
        crumbs={[{ label: t("nav_settings") }, { label: t("nav_notifications") }]}
      />

      <section aria-labelledby="nf-types" className="mb-8 rounded-xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
        <h2 id="nf-types" className="mb-1 text-[15px] font-bold text-ink">{t("u_nfTypes")}</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("u_nfTypesDesc")}</p>
        {prefsQ.isLoading ? (
          <LuxurySkeleton lines={3} />
        ) : prefsQ.isError ? (
          <ErrorState reset={() => prefsQ.refetch()} description={errorMessage(prefsQ.error)} />
        ) : (
          <div className="grid gap-3">
            <PrefRow
              label={t("u_nfPrice")}
              desc={t("u_nfPriceDesc")}
              checked={prefs?.price_alerts_email ?? true}
              disabled={!prefs || save.isPending}
              onChange={() => toggle("price_alerts_email")}
            />
            <PrefRow
              label={t("u_nfShariah")}
              desc={t("u_nfShariahDesc")}
              checked={prefs?.shariah_decisions_email ?? true}
              disabled={!prefs || save.isPending}
              onChange={() => toggle("shariah_decisions_email")}
            />
            <PrefRow
              label={t("u_nfPositions")}
              desc={t("u_nfPositionsDesc")}
              checked={prefs?.position_updates_email ?? true}
              disabled={!prefs || save.isPending}
              onChange={() => toggle("position_updates_email")}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="nf-watch" className="rounded-xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
        <h2 id="nf-watch" className="mb-1 text-[15px] font-bold text-ink">{t("u_nfWatched")}</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("u_nfWatchedDesc")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const sym = newSym.trim().toUpperCase();
            if (!sym) return;
            addM.mutate(sym);
            setNewSym("");
          }}
          className="mb-4 flex min-w-0 gap-2"
        >
          <input
            value={newSym}
            onChange={(e) => setNewSym(e.target.value)}
            placeholder={t("u_nfSymbolPlaceholder")}
            aria-label={t("u_nfSymbolPlaceholder")}
            maxLength={16}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm uppercase text-foreground focus:border-[var(--gold-deep)] focus:outline-none sm:min-h-10"
          />
          <button
            type="submit"
            disabled={!newSym.trim() || addM.isPending}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50 sm:min-h-10"
          >
            <Plus aria-hidden className="h-4 w-4" /> {t("u_nfAdd")}
          </button>
        </form>
        {watchersQ.isLoading ? (
          <LuxurySkeleton lines={2} />
        ) : watchers.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("u_nfNoWatched")}</p>
        ) : (
          <ul className="grid gap-2">
            {watchers.map((w) => (
              <li
                key={w.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink" dir="ltr" style={{ textAlign: "start" }}>{w.symbol}</div>
                  <div className="text-xs text-muted-foreground">{assetClassLabel(w.asset_class, t)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => rmM.mutate(w.symbol)}
                  disabled={rmM.isPending}
                  className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-muted-foreground hover:border-[var(--burgundy)] hover:text-[var(--burgundy)] disabled:opacity-50 sm:min-h-9 sm:min-w-9"
                  aria-label={`${t("u_nfRemove")} ${w.symbol}`}
                >
                  <Trash aria-hidden className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function PrefRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-border/60 bg-background px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-5 w-5 accent-[var(--gold-deep)]"
      />
    </label>
  );
}
