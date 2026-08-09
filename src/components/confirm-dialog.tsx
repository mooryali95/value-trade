import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";

type Tone = "default" | "danger";

type Options = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
};

type Ctx = {
  confirm: (opts: Options) => Promise<boolean>;
};

const ConfirmContext = React.createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = React.useState<
    (Options & { resolve: (v: boolean) => void }) | null
  >(null);
  // The dialog has no DOM trigger, so remember the opener and restore focus manually.
  const opener = React.useRef<HTMLElement | null>(null);

  const confirm = React.useCallback<Ctx["confirm"]>((opts) => {
    opener.current = (document.activeElement as HTMLElement | null) ?? null;
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
    const el = opener.current;
    opener.current = null;
    if (el && document.contains(el)) {
      window.setTimeout(() => el.focus({ preventScroll: true }), 0);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ink">{state?.title}</AlertDialogTitle>
            {state?.description && (
              <AlertDialogDescription className="text-muted-foreground">
                {state.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {state?.cancelLabel ?? t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={
                state?.tone === "danger"
                  ? "bg-[var(--bear)] text-ivory hover:bg-[var(--bear)]/90"
                  : "gold-gradient text-ink"
              }
            >
              {state?.confirmLabel ?? t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx.confirm;
}