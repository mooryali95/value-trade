import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMyRoles } from "@/hooks/use-my-roles";

export type AppMode = "investor" | "brand" | "platform";

const STORAGE_KEY = "vu_active_mode";

function readStored(): AppMode | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "investor" || v === "brand" || v === "platform" ? v : null;
}

/** Priority when no valid stored preference exists: platform > brand > investor. */
function defaultMode(available: AppMode[]): AppMode {
  if (available.includes("platform")) return "platform";
  if (available.includes("brand")) return "brand";
  return "investor";
}

type Ctx = {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  availableModes: AppMode[];
};

const AppModeContext = createContext<Ctx>({
  mode: "investor",
  setMode: () => {},
  availableModes: ["investor"],
});

export function AppModeProvider({ children }: { children: ReactNode }) {
  const { roles } = useMyRoles();

  const availableModes = useMemo<AppMode[]>(() => {
    const modes: AppMode[] = ["investor"];
    if (roles && Object.keys(roles.companyRoles).length > 0) modes.push("brand");
    if (roles?.appRoles?.includes("platform_admin")) modes.push("platform");
    return modes;
  }, [roles]);

  const [mode, setModeState] = useState<AppMode>("investor");

  // Resolve the effective mode once roles are known: prefer a still-valid
  // stored choice, otherwise fall back to the priority default. Re-runs if
  // roles change (e.g. a role was revoked mid-session) to avoid stranding
  // the user on a mode they no longer have access to.
  useEffect(() => {
    const stored = readStored();
    const next = stored && availableModes.includes(stored) ? stored : defaultMode(availableModes);
    setModeState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModes.join(",")]);

  const setMode = (m: AppMode) => {
    if (!availableModes.includes(m)) return;
    setModeState(m);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, m);
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode, availableModes }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  return useContext(AppModeContext);
}
