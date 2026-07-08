import { cn } from "@/lib/utils";

type Props = { className?: string; lines?: number };

export function LuxurySkeleton({ className, lines = 1 }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="relative h-3 w-full overflow-hidden rounded bg-[color:var(--stone)]">
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite]"
            style={{ background: "linear-gradient(90deg, transparent, oklch(0.68 0.12 78 / 0.18), transparent)" }}
          />
        </div>
      ))}
      <style>{`@keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>
    </div>
  );
}

export function LuxurySkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-[color:var(--stone)]", className)}>
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite]"
        style={{ background: "linear-gradient(90deg, transparent, oklch(0.68 0.12 78 / 0.18), transparent)" }}
      />
      <style>{`@keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>
    </div>
  );
}