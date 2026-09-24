import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Whether a Supabase session exists in this browser. `null` until the first
 * session read finishes, so callers can render a neutral loading state
 * instead of flashing the signed-out UI.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setSignedIn(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return signedIn;
}
