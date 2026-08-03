import { useCallback, useEffect, useState } from "react";

const KEY = "vu:reduce-motion";

function apply(reduced: boolean) {
  if (typeof document === "undefined") return;
  if (reduced) document.documentElement.setAttribute("data-motion", "reduced");
  else document.documentElement.removeAttribute("data-motion");
}

/**
 * User-controllable motion preference. Defaults to the OS
 * `prefers-reduced-motion` setting and persists any manual override.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    const system = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = stored === null ? system : stored === "1";
    setReduced(next);
    apply(next);
  }, []);

  const toggle = useCallback(() => {
    setReduced((prev) => {
      const next = !prev;
      localStorage.setItem(KEY, next ? "1" : "0");
      apply(next);
      return next;
    });
  }, []);

  return { reduced, toggle };
}
