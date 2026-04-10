-- ============================================================
-- 010: Durable BOQ processing recovery state
-- Tracks paid-but-incomplete BOQs so users can resume without
-- paying again after AI failures or timeouts.
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_context JSONB;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_processing_status_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_processing_status_check
        CHECK (processing_status IN ('pending', 'processing', 'failed', 'completed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS boqs_processing_status_idx ON public.boqs(processing_status);
CREATE INDEX IF NOT EXISTS boqs_payment_processing_idx ON public.boqs(payment_status, processing_status);
