import { useEffect, useRef } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Signed-in area. The session lives in the browser (localStorage), so these
 * routes render on the client only (ssr: false): the server sends the shell
 * and the client checks the session.
 *
 * A visitor without a session is sent to /auth from the component, after
 * hydration, not by throwing a redirect in beforeLoad: that redirect could
 * resolve while React was still hydrating the server HTML of the requested
 * page, which then no longer matched (a hydration error on every anonymous
 * visit to a guarded URL). Server functions check the session themselves.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    return { user: error ? null : (data.user ?? null) };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  // Once only, with the page that was asked for: while the navigation runs,
  // the location already reads /auth.
  const redirected = useRef(false);
  useEffect(() => {
    if (user || redirected.current) return;
    redirected.current = true;
    void navigate({ to: "/auth", search: { redirect: href }, replace: true });
  }, [user, href, navigate]);
  if (!user) return null;
  return <Outlet />;
}
