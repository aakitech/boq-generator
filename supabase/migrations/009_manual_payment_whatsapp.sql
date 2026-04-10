-- ============================================================
-- 009: Manual payment metadata for WhatsApp fallback
-- Tracks payment source and manual-payment request context on BOQs
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS payment_source TEXT,
  ADD COLUMN IF NOT EXISTS manual_payment_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_payment_contact TEXT,
  ADD COLUMN IF NOT EXISTS manual_payment_reference TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_payment_source_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_payment_source_check
        CHECK (
          payment_source IS NULL OR payment_source IN ('stripe', 'manual_whatsapp')
        );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS boqs_payment_source_idx ON public.boqs(payment_source);
CREATE INDEX IF NOT EXISTS boqs_manual_payment_requested_at_idx ON public.boqs(manual_payment_requested_at DESC);
