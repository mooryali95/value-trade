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

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({
    meta: [
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });
  const addM = useMutation({
    mutationFn: (symbol: string) => addW({ data: { symbol, asset_class: "brand" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchers"] }),
  });
  const rmM = useMutation({
    mutationFn: (symbol: string) => rmW({ data: { symbol } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchers"] }),
  });

  const [newSym, setNewSym] = useState("");

  const toggle = (k: keyof NotificationPreferences) => {
    if (!prefs) return;
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    save.mutate(next);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Settings"
        title="تفضيلات الإشعارات · Notifications"
        description="اختر أنواع الرسائل التي تريد استلامها، وتابع الرموز التي تهمّك."
        crumbs={[{ label: "Settings", to: "/settings/notifications" }, { label: "الإشعارات" }]}
      />

      <section className="mb-10 rounded-xl border border-border/60 bg-card/60 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          أنواع الرسائل
        </h2>
        <div className="grid gap-3">
          <PrefRow
            label="تنبيهات السعر · Price alerts"
            desc="عند وصول أحد التنبيهات المحدّدة إلى مستواه."
            checked={prefs?.price_alerts_email ?? true}
            onChange={() => toggle("price_alerts_email")}
          />
          <PrefRow
            label="قرارات الشرعية · Shariah decisions"
            desc="تحديثات على الحالة الشرعية للرموز التي تحملها أو تتابعها."
            checked={prefs?.shariah_decisions_email ?? true}
            onChange={() => toggle("shariah_decisions_email")}
          />
          <PrefRow
            label="تحديثات المراكز · Position updates"
            desc="أحداث مهمّة على الرموز التي تحمل فيها مراكز."
            checked={prefs?.position_updates_email ?? true}
            onChange={() => toggle("position_updates_email")}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card/60 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          الرموز المتابَعة · Watched symbols
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const s = newSym.trim().toUpperCase();
            if (!s) return;
            addM.mutate(s);
            setNewSym("");
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={newSym}
            onChange={(e) => setNewSym(e.target.value)}
            placeholder="ARAMCO"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono uppercase text-foreground focus:border-[var(--gold-deep)] focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gold-deep)]/40 bg-[var(--gold-soft)] px-3 py-2 text-xs font-semibold text-ink hover:border-[var(--gold-deep)]"
          >
            <Plus className="h-3.5 w-3.5" /> إضافة
          </button>
        </form>
        <div className="grid gap-2">
          {(watchersQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">لا يوجد رموز متابَعة بعد.</p>
          )}
          {(watchersQ.data ?? []).map((w) => (
            <div
              key={w.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-foreground">{w.symbol}</div>
                <div className="text-[10px] text-muted-foreground">{w.asset_class}</div>
              </div>
              <button
                onClick={() => rmM.mutate(w.symbol)}
                className="rounded-md border border-border p-2 text-muted-foreground hover:border-[var(--burgundy)] hover:text-[var(--burgundy)]"
                aria-label="remove"
              >
                <Trash className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function PrefRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 rounded-md border border-border/60 bg-background px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 accent-[var(--gold-deep)]"
      />
    </label>
  );
}