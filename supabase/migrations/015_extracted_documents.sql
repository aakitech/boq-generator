CREATE TABLE IF NOT EXISTS public.extracted_documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id         UUID        NOT NULL REFERENCES public.boqs(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename       TEXT        NOT NULL,
  text           TEXT        NOT NULL,
  pages          INTEGER     NULL,
  drawing_type   TEXT        NULL,
  subject_name   TEXT        NULL,
  used_vision    BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS extracted_documents_boq_id_idx ON public.extracted_documents(boq_id);
CREATE INDEX IF NOT EXISTS extracted_documents_user_id_idx ON public.extracted_documents(user_id);

ALTER TABLE public.extracted_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='extracted_documents' AND policyname='extracted_documents_select_own') THEN
    CREATE POLICY extracted_documents_select_own ON public.extracted_documents FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='extracted_documents' AND policyname='extracted_documents_delete_own') THEN
    CREATE POLICY extracted_documents_delete_own ON public.extracted_documents FOR DELETE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='extracted_documents' AND policyname='extracted_documents_insert_service') THEN
    CREATE POLICY extracted_documents_insert_service ON public.extracted_documents FOR INSERT WITH CHECK (true);
  END IF;
END $$;
