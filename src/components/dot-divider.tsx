export function DotDivider({ className }: { className?: string }) {
  return (
    <div className={`relative flex items-center gap-3 ${className ?? ""}`}>
      <div className="h-px flex-1 hairline-gold" />
      <svg width="48" height="12" viewBox="0 0 48 12" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <circle key={i} cx={4 + i * 5} cy={6} r={i === 4 ? 2 : 1.2} fill="var(--gold-deep)" opacity={i === 4 ? 1 : 0.5} />
        ))}
      </svg>
      <div className="h-px flex-1 hairline-gold" />
    </div>
  );
}