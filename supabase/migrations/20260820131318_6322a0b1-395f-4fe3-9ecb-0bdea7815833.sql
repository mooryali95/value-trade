CREATE TABLE public.brands (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  sector text,
  asset_class text NOT NULL DEFAULT 'brand',
  reference_price numeric NOT NULL DEFAULT 100,
  published boolean NOT NULL DEFAULT false,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  source_submission_id uuid REFERENCES public.product_submissions(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.brands TO anon;
GRANT SELECT ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brands_public_read_published" ON public.brands
  FOR SELECT TO anon, authenticated USING (published = true);

CREATE POLICY "brands_company_members_read_own" ON public.brands
  FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND public.is_company_member(auth.uid(), company_id));

CREATE POLICY "brands_platform_admin_read_all" ON public.brands
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "brands_platform_admin_insert" ON public.brands
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "brands_platform_admin_update" ON public.brands
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "brands_company_owner_update" ON public.brands
  FOR UPDATE TO authenticated
  USING (company_id IS NOT NULL AND public.is_company_owner(auth.uid(), company_id))
  WITH CHECK (company_id IS NOT NULL AND public.is_company_owner(auth.uid(), company_id));

CREATE TRIGGER trg_brands_updated BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_brands_asset_class ON public.brands (asset_class);
CREATE INDEX idx_brands_company ON public.brands (company_id);

WITH RECURSIVE lcg(n, s) AS (
  SELECT 0, 4242::bigint
  UNION ALL
  SELECT n + 1, (s * 9301 + 49297) % 233280 FROM lcg WHERE n < 1540
),
arrays AS (
  SELECT
    ARRAY['نور','بيت','درة','واحة','نجم','قصر','تاج','برج','سما','بحر','جبل','نخيل','ذهب','لؤلؤ','فجر','شمس','قمر','ريان','مسك','عود','صقر','رياض','مدى','أفق','رمال','واثق','أصيل','صدى','نبض','وسام']::text[] AS ar_roots,
    ARRAY['للتقنية','الغذائية','للأزياء','الطبية','للطاقة','للاستثمار','العقارية','للنقل','للتعليم','للإعلام','للتجزئة','للسيارات','المالية','للمنتجات','للخدمات']::text[] AS ar_suffix,
    ARRAY['Noor','Beit','Durra','Waha','Najm','Qasr','Taj','Burj','Sama','Bahr','Jabal','Nakhil','Dhahab','Loloa','Fajr','Shams','Qamar','Rayan','Musk','Oud','Saqr','Riyad','Mada','Ufuq','Rimal','Wathiq','Aseel','Sada','Nabd','Wisam']::text[] AS en_roots,
    ARRAY['Tech','Foods','Fashion','Health','Energy','Capital','Estates','Logistics','Learning','Media','Retail','Motors','Finance','Group','Ventures']::text[] AS en_suffix,
    ARRAY['tech','fintech','food','fashion','media','health','energy','logistics','realestate','education','retail','auto']::text[] AS sectors
)
INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, asset_class, reference_price, published)
SELECT
  sym,
  lower(sym),
  a.ar_roots[(i % 30) + 1] || ' ' || a.ar_suffix[((i * 7) % 15) + 1],
  a.en_roots[(i % 30) + 1] || ' ' || a.en_suffix[((i * 7) % 15) + 1],
  a.sectors[(i % 12) + 1],
  'brand',
  round((5 + (l.s::numeric / 233280) * 495)::numeric, 2),
  true
FROM generate_series(0, 255) AS i
CROSS JOIN arrays a
JOIN lcg l ON l.n = 6 * i + 1
CROSS JOIN LATERAL (
  SELECT upper(substr(a.en_roots[(i % 30) + 1], 1, 3)) || lpad((i + 1)::text, 3, '0') AS sym
) s0
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, asset_class, reference_price, published) VALUES
('2222','2222','أرامكو السعودية','Saudi Aramco','energy','stock',28.4,true),
('1120','1120','الراجحي','Al Rajhi Bank','fintech','stock',92.1,true),
('7010','7010','الاتصالات السعودية','STC','tech','stock',39.8,true),
('2010','2010','سابك','SABIC','energy','stock',74.3,true),
('4013','4013','الدواء','Al Dawaa Medical','health','stock',66.0,true),
('4001','4001','أسواق العثيم','Othaim Markets','retail','stock',12.6,true),
('4002','4002','مركز الرعاية الطبية','Care Medical','health','stock',138.0,true),
('EMAAR','emaar','إعمار العقارية','Emaar Properties','realestate','stock',8.2,true),
('ADCB','adcb','بنك أبوظبي التجاري','ADCB','fintech','stock',9.4,true),
('SALIK','salik','سالك','Salik','logistics','stock',5.1,true),
('OMTL','omtl','عمانتل','Omantel','tech','stock',0.83,true),
('BHTL','bhtl','بتلكو','Batelco','tech','stock',0.42,true),
('KSA-30','ksa-30','صكوك حكومة السعودية 2030','KSA Govt Sukuk 2030','fintech','sukuk',100.5,true),
('KSA-33','ksa-33','صكوك حكومة السعودية 2033','KSA Govt Sukuk 2033','fintech','sukuk',100.9,true),
('IDB-28','idb-28','صكوك البنك الإسلامي للتنمية','IsDB Sukuk 2028','fintech','sukuk',101.2,true),
('ARB-31','arb-31','صكوك الراجحي 2031','Al Rajhi Sukuk 2031','fintech','sukuk',99.8,true),
('STC-29','stc-29','صكوك STC 2029','STC Sukuk 2029','fintech','sukuk',100.3,true),
('DPW-32','dpw-32','صكوك موانئ دبي 2032','DP World Sukuk 2032','fintech','sukuk',101.1,true),
('EMR-27','emr-27','صكوك إعمار 2027','Emaar Sukuk 2027','fintech','sukuk',98.6,true),
('QAT-34','qat-34','صكوك قطر السيادية 2034','Qatar Sovereign Sukuk 2034','fintech','sukuk',101.46,true)
ON CONFLICT (symbol) DO NOTHING;