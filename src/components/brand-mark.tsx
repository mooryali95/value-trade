import { ValueDots } from "@/components/dot-pattern";
import { SITE } from "@/lib/config/site";

type Props = {
  size?: number;
  showText?: boolean;
  color?: string; // dot + text color
  className?: string;
};

// Value Unit brand mark rendered as pure SVG + text (no image, no box).
// Matches the logo language: dot matrix on the left, Arabic brand name "وحدة القيمة" + "VALUE UNIT" caption.
export function BrandMark({ size = 36, showText = true, color, className }: Props) {
  const c = color ?? "var(--ink)";
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <ValueDots size={size * 0.78} color={c} />
      {showText && (
        <div className="flex flex-col leading-none">
          <span
            className="whitespace-nowrap font-black tracking-tight"
            style={{ color: c, fontSize: size * 0.42, fontFamily: "Tajawal, system-ui, sans-serif" }}
          >
            {SITE.brandAr}
          </span>
          <span
            className="mt-0.5 font-medium uppercase"
            style={{
              color: "var(--gold-deep)",
              fontSize: size * 0.24,
              letterSpacing: "0.28em",
            }}
          >
            {SITE.brandEn}
          </span>
        </div>
      )}
    </div>
  );
}

export { ValueDots };