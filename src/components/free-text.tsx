import { useI18n } from "@/lib/i18n";
import { ARABIC_SCRIPT, LATIN_SCRIPT, textLanguage } from "@/lib/text-language";

/**
 * Text someone typed in one language (a Shariah ruling's reason, a note),
 * shown on a page in either language: it keeps its own direction and
 * language tag, and says which language it is in when that differs from the
 * page's, instead of mixing silently into the other language's layout.
 */
export function FreeText({ text, className }: { text: string | null | undefined; className?: string }) {
  const { t, lang } = useI18n();
  if (!text || !text.trim()) return <span className={className}>—</span>;
  const own = textLanguage(text);
  const foreign = own !== null && own !== lang && (own === "ar" ? ARABIC_SCRIPT.test(text) : LATIN_SCRIPT.test(text));
  return (
    <span className={className}>
      <span dir="auto" lang={own ?? undefined}>{text}</span>
      {foreign && (
        <span className="ms-1 text-[10px] text-muted-foreground">
          {own === "ar" ? t("fx3_writtenInArabic") : t("fx3_writtenInEnglish")}
        </span>
      )}
    </span>
  );
}
