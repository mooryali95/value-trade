import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyCompanies } from "@/lib/tenants/company.functions";

const STORAGE_KEY = "value.activeCompanyId";

export type ActiveCompany = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  plan: string | null;
  role: string;
};

export function useActiveCompany() {
  const listFn = useServerFn(listMyCompanies);
  const q = useQuery({ queryKey: ["my-companies"], queryFn: () => listFn(), staleTime: 60_000 });

  const companies: ActiveCompany[] = (q.data ?? [])
    .map((m: { role: string; company: { id: string; slug: string; name_ar: string; name_en: string; plan: string | null } | null }) =>
      m.company ? { ...m.company, role: m.role } : null,
    )
    .filter(Boolean) as ActiveCompany[];

  const [activeId, setActiveIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setActiveIdState(saved);
  }, []);

  useEffect(() => {
    if (!companies.length) return;
    if (!activeId || !companies.find((c) => c.id === activeId)) {
      setActiveIdState(companies[0].id);
    }
  }, [companies, activeId]);

  const setActive = useCallback((id: string) => {
    setActiveIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const active = companies.find((c) => c.id === activeId) ?? null;
  return { companies, active, activeId, setActive, isLoading: q.isLoading };
}