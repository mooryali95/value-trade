import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccountStatus } from "@/lib/account/account-status.functions";

/**
 * The signed-in account's status (getMyAccountStatus): trading activation,
 * review hold, cash and buying power. Shares its cache entry with the shell's
 * AccountStatusBanner and the home page (["account-status", userId]).
 * `data` is undefined for visitors and while loading.
 */
export function useAccountStatus() {
  const fn = useServerFn(getMyAccountStatus);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setUserId(session?.user.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return useQuery({
    queryKey: ["account-status", userId],
    queryFn: () => fn(),
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });
}
