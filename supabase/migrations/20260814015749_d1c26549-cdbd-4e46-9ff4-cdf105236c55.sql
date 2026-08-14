CREATE TABLE public.submission_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.product_submissions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL UNIQUE,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submission_documents_submission_idx ON public.submission_documents(submission_id);

GRANT SELECT, INSERT, DELETE ON public.submission_documents TO authenticated;
GRANT ALL ON public.submission_documents TO service_role;

ALTER TABLE public.submission_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submission_docs_select" ON public.submission_documents
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(auth.uid(), company_id)
    OR public.has_role(auth.uid(), 'shariah_board')
    OR public.has_role(auth.uid(), 'platform_admin')
  );

CREATE POLICY "submission_docs_insert" ON public.submission_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      public.has_company_role(auth.uid(), company_id, 'owner')
      OR public.has_company_role(auth.uid(), company_id, 'finance')
    )
  );

CREATE POLICY "submission_docs_delete" ON public.submission_documents
  FOR DELETE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'owner')
    OR public.has_role(auth.uid(), 'platform_admin')
  );