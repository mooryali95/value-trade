// Value Unit — dot matrix pattern derived from the "قيمة" logo.
// Use as a decorative background layer.

type Props = {
  size?: number; // grid cell size in px
  radius?: number; // dot radius in px
  className?: string;
  color?: string; // any CSS color / var
  opacity?: number;
};

export function DotPattern({
  size = 18,
  radius = 1.1,
  className,
  color = "var(--ink)",
  opacity = 0.08,
}: Props) {
  const id = `dot-${size}-${radius}`;
  return (
    <svg
      aria-hidden
      className={className}
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}
    >
      <defs>
        <pattern id={id} x="0" y="0" width={size} height={size} patternUnits="userSpaceOnUse">
          <circle cx={size / 2} cy={size / 2} r={radius} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// The literal 5-column dot mark from the قيمة logo. Use as the compact icon.
export function ValueDots({ size = 28, color = "var(--ink)" }: { size?: number; color?: string }) {
  // 5 columns x 6 rows, tightly packed
  const cols = 5;
  const rows = 6;
  const gap = size / (cols + 1);
  const r = gap * 0.28;
  const dots: Array<[number, number]> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      dots.push([gap * (x + 1), gap * (y + 1)]);
    }
  }
  return (
    <svg width={size} height={(size * rows) / (cols + 1) + gap} viewBox={`0 0 ${size} ${gap * (rows + 1)}`} aria-hidden>
      {dots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill={color} />
      ))}
    </svg>
  );
}