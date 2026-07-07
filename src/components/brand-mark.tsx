import { ValueDots } from "@/components/dot-pattern";

type Props = {
  size?: number;
  showText?: boolean;
  color?: string; // dot + text color
  className?: string;
};

// Value Unit brand mark rendered as pure SVG + text (no image, no box).
// Matches the قيمة logo language: dot matrix on the left, Arabic name + "VALUE UNIT" caption.
export function BrandMark({ size = 36, showText = true, color, className }: Props) {
  const c = color ?? "var(--ink)";
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <ValueDots size={size * 0.78} color={c} />
      {showText && (
        <div className="flex flex-col leading-none">
          <span
            className="font-black tracking-tight"
            style={{ color: c, fontSize: size * 0.5, fontFamily: "Tajawal, system-ui, sans-serif" }}
          >
            قيمة
          </span>
          <span
            className="mt-0.5 font-medium uppercase"
            style={{
              color: "var(--gold-deep)",
              fontSize: size * 0.24,
              letterSpacing: "0.28em",
            }}
          >
            Value Unit
          </span>
        </div>
      )}
    </div>
  );
}

export { ValueDots };