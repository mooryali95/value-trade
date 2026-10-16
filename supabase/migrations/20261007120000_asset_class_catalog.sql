-- Approved asset classes. Mirrors src/lib/market/asset-classes.ts.
ALTER TABLE public.brands
  ADD CONSTRAINT brands_asset_class_approved
  CHECK (asset_class IN ('stock','fund','sukuk','brand')) NOT VALID;
ALTER TABLE public.brands VALIDATE CONSTRAINT brands_asset_class_approved;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_asset_class_approved
  CHECK (asset_class IN ('stock','fund','sukuk','brand')) NOT VALID;
ALTER TABLE public.product_submissions VALIDATE CONSTRAINT product_submissions_asset_class_approved;
COMMENT ON COLUMN public.brands.asset_class IS 'Approved class: stock | fund | sukuk | brand (see src/lib/market/asset-classes.ts).';