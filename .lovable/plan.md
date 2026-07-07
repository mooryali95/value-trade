# خطة إعادة ضبط الهوية البصرية الفاخرة

## الأهداف

1. رفع مستوى الألوان لكل المنصة إلى درجات Luxury حقيقية (كحلي عميق + ذهبي معدني + عاجي دافئ + عنابي ملكي).
2. استخدام شعار "قيمة / Value Unit" **بدون الإطار / الحواف** كعلامة رسمية.
3. توظيف **نقاط الشعار (Dot Matrix)** كـ Pattern بصري متكرر في الخلفيات والأقسام الفاخرة.
4. استبدال أيقونات lucide-react العامة بمكتبة أيقونات احترافية مخصصة لمنصات التداول.
5. إزالة أي إيحاءات تدل على AI/Vibe Coding (تدرجات بنفسجية، إيموجي، أيقونات عامة، ظلال ملونة).
6. توحيد جميع النصوص على خط **Tajawal** (خط ثمانية / Thmanyah-style) للعربي والإنجليزي.
7. ترسيخ اسم العلامة: **قيمة — Value Unit** في كل مكان.

---

## 1. الشعار (Logo)

- رفع نسخة الشعار **بدون الإطار الأبيض والحدود** كأصل رئيسي عبر `lovable-assets` من المرفق الحالي (crop للنقاط + النص فقط).
- تحديث `src/components/app-shell.tsx` → `BrandMark`:
  - إظهار الشعار الفعلي (النقاط + كلمة "قيمة" + "VALUE UNIT") مباشرة، بدون خلفية ذهبية مربعة.
  - نسختان: `BrandMarkFull` (نقاط + نص) و `BrandMarkDots` (النقاط فقط للأيقونة المصغرة / Favicon / Loader).
- تحديث `favicon` و `og:image` (leaf routes فقط) لاستخدام الشعار النظيف.

## 2. Dot Matrix Pattern

- إنشاء `src/components/dot-pattern.tsx`: مكوّن SVG قابل لإعادة الاستخدام يرسم شبكة نقاط بنفس نسبة شعار قيمة (5×5 أو 8×8) مع تحكم بالكثافة والحجم واللون والـ opacity.
- استخدامه في:
  - خلفية Hero في `index.tsx` (نقاط ذهبية باهتة على العاجي).
  - Header الـ AppShell (شريط رفيع من النقاط).
  - بطاقات Empty State / Auth split panel / Shariah page.
  - Watermark خفيف خلف بطاقات البراند.

## 3. نظام الألوان الفاخر (src/styles.css)

إعادة معايرة كل الـ tokens في `@theme inline` و `:root`:


| Token                | القيمة الجديدة                       | الاستخدام                  |
| -------------------- | ------------------------------------ | -------------------------- |
| `--background`       | `oklch(0.985 0.006 85)` عاجي دافئ    | خلفية عامة                 |
| `--surface`          | `oklch(0.965 0.008 82)`              | البطاقات                   |
| `--surface-elevated` | `oklch(0.99 0.004 85)`               | Modals                     |
| `--ink` (foreground) | `oklch(0.18 0.04 260)` كحلي عميق     | النصوص                     |
| `--ink-soft`         | `oklch(0.35 0.03 260)`               | نصوص ثانوية                |
| `--muted-foreground` | `oklch(0.52 0.02 260)`               | Labels                     |
| `--gold` (primary)   | `oklch(0.68 0.12 78)` ذهب معدني عميق | Accents/CTA                |
| `--gold-deep`        | `oklch(0.55 0.13 72)`                | Hover/borders              |
| `--gold-soft`        | `oklch(0.92 0.05 85)`                | خلفيات ناعمة               |
| `--burgundy`         | `oklch(0.38 0.13 25)` عنابي ملكي     | Highlights, Shariah badges |
| `--bull`             | `oklch(0.52 0.13 155)` أخضر زمردي    | صعود                       |
| `--bear`             | `oklch(0.48 0.18 28)` أحمر عنابي     | هبوط                       |
| `--border`           | `oklch(0.88 0.01 82)`                | حدود شعرة                  |
| `--border-gold`      | `oklch(0.75 0.08 82)`                | حدود مميزة                 |


**Shadows** (soft luxury، بلا هالات ملونة):

- `--shadow-hairline`: `0 0 0 1px oklch(0.88 0.01 82)`
- `--shadow-card`: `0 1px 2px oklch(0.2 0.03 260 / 0.04), 0 8px 24px oklch(0.2 0.03 260 / 0.06)`
- `--shadow-luxury`: `0 2px 4px oklch(0.2 0.03 260 / 0.06), 0 24px 48px oklch(0.2 0.03 260 / 0.08)`
- `--shadow-gold`: `0 1px 2px oklch(0.55 0.13 72 / 0.15), 0 8px 20px oklch(0.55 0.13 72 / 0.1)`

**Gradients:**

- `--gradient-ink`: `linear-gradient(135deg, oklch(0.18 0.04 260), oklch(0.24 0.05 265))` — أزرار داكنة فقط.
- `--gradient-gold`: `linear-gradient(135deg, oklch(0.72 0.11 82), oklch(0.62 0.13 76))` — أزرار CTA أساسية.
- ❌ حذف أي تدرج بنفسجي/وردي/نيون.

**ألوان البراندات** (badges في السوق): استبدال البالتة الحالية (أخضر/أصفر/بنفسجي/زهري) بـ **بالتة موحّدة رصينة**: 8 درجات مشتقة من كحلي/ذهبي/عنابي/زمردي/نحاسي/فحمي، مع أحرف الرمز بلون عاجي وخلفية مربّع بحدود ذهبية شعرة.

## 4. الطباعة (Typography)

- اعتماد **Tajawal** كخط أساسي (عربي + إنجليزي) عبر `<link>` في `__root.tsx` head.
- تدرج الأوزان: 300 / 400 / 500 / 700 / 900.
- `--font-display`: Tajawal 900 (عناوين ضخمة، tracking سالب).
- `--font-body`: Tajawal 400/500.
- `--font-mono`: `JetBrains Mono` للأرقام المالية (tabular-nums دائماً).
- إزالة أي استخدام لـ Inter / Poppins / system-ui.

## 5. الأيقونات الاحترافية

- إضافة `**@phosphor-icons/react**` (Duotone/Bold weights) — مستخدمة في Bloomberg-style dashboards.
- إضافة `**@tabler/icons-react**` كمكمّل للأيقونات المالية المتخصصة (candles, order-book, portfolio).
- استبدال lucide في:
  - AppShell nav → Phosphor Duotone.
  - Trade page (buy/sell, order types) → Tabler finance icons.
  - Shariah page → Phosphor (shield-check, scales, mosque).
  - Market table sort/filter → Phosphor Bold.
- الاحتفاظ بـ lucide فقط للأدوات العامة (X, Check, ChevronDown).

## 6. تنظيف مظاهر AI / Vibe Coding

- إزالة أي: gradients بنفسجية، shadows ملونة (purple/pink glow)، رموز إيموجي في UI، بطاقات "مبنية بواسطة"، placeholders افتراضية.
- تشديد الشبكة (grid discipline): spacing على مضاعفات 4px، radii ثابتة (`--radius-sm: 4px`, `md: 8px`, `lg: 12px`, `xl: 16px`).
- استخدام hairline borders + soft shadows بدلاً من ظلال ثقيلة.
- Micro-interactions هادئة (150-200ms، ease-out فقط، بلا bounce).

## 7. تطبيق الهوية على الصفحات القائمة

تحديث بصري فقط (بدون تغيير المنطق) لـ:

- `index.tsx` — Hero بخلفية Dot Pattern ذهبية باهتة، KPIs ببطاقات hairline.
- `market.tsx` — badges البراندات بالبالتة الجديدة، صف الفلاتر بنمط pill فاخر بحدود ذهبية.
- `market.$slug.tsx` — Header براند بنقاط pattern في الخلفية.
- `trade.$symbol.tsx` — أيقونات Tabler، أزرار Buy/Sell بلون bull/bear الجديد.
- `company.$id.tsx`، `_authenticated/workspace.tsx`، `shariah.tsx`، `auth.tsx` — تطبيق نفس النظام.
- `app-shell.tsx` — Header بشعار جديد، user-menu بأيقونات Phosphor.

## 8. توحيد اسم العلامة

- كل ذِكر للاسم في UI/i18n/meta:
  - عربي: وحدة القيمة
  - إنجليزي: **Value Unit** (بدون Value Innovation).
- تحديث `i18n.tsx`، `__root.tsx` (title/description/og)، `app-shell.tsx`.

---

## الملفات المتأثرة

**Create:**

- `src/assets/value-logo-clean.png.asset.json` (شعار بدون إطار)
- `src/components/dot-pattern.tsx`
- `src/components/brand-mark.tsx` (استخراج من app-shell)

**Edit:**

- `src/styles.css` (إعادة كتابة كاملة للـ tokens)
- `src/routes/__root.tsx` (Tajawal + JetBrains Mono links + meta)
- `src/components/app-shell.tsx` (Brand + أيقونات Phosphor)
- `src/lib/i18n.tsx` (اسم العلامة)
- `src/lib/mock-data.ts` (بالتة ألوان البراند)
- كل ملفات `src/routes/*` (استبدال lucide → Phosphor/Tabler حيث لزم + tokens جديدة)

**Install:**

- `@phosphor-icons/react`
- `@tabler/icons-react`

---

## تفاصيل تقنية (للمراجعة)

- Tajawal يُحمّل عبر `<link rel="preconnect" href="https://fonts.googleapis.com">` + `<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">` في `__root.tsx` (لا `@import` في CSS بسبب Lightning CSS).
- Dot Pattern SVG: `<pattern>` بـ `<circle r="1.5" fill="currentColor">` وعُقد 12px، يُستخدم عبر `<div style={{color: 'var(--gold)'}} className="opacity-[0.08]">`.
- كل ألوان OKLCH تُعرَّف في `:root` ثم تُربط بـ `@theme inline` لتوليد utilities (`bg-gold`, `text-ink`, `border-gold`, ...).
- لا تغييرات على Schema/RLS/Auth في هذه المرحلة.