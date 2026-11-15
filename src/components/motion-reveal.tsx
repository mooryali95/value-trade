import { useEffect, useRef, type HTMLAttributes } from "react";

/** One-time viewport entrance. Content remains visible without JavaScript. */
export function MotionReveal({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Also honour the in-app "Reduce motion" toggle (useReducedMotion sets html[data-motion]).
    const userReduced = () => document.documentElement.dataset.motion === "reduced";
    if (preference.matches || userReduced() || !("IntersectionObserver" in window)) return;

    let animation: Animation | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      if (preference.matches || userReduced()) return;
      animation = element.animate(
        [{ opacity: 0.35, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 640, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }, { threshold: 0.12 });
    const stop = () => {
      if (preference.matches) {
        observer.disconnect();
        animation?.cancel();
      }
    };
    observer.observe(element);
    preference.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animation?.cancel();
      preference.removeEventListener("change", stop);
    };
  }, []);

  return <div ref={ref} {...props}>{children}</div>;
}