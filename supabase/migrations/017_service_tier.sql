-- ============================================================
-- 017: Done-for-you service tier
-- Adds service job columns to boqs for operator-managed jobs
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS service_tier TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS service_status TEXT NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS service_package TEXT,
  ADD COLUMN IF NOT EXISTS service_payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS service_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_delivered_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_service_tier_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_service_tier_check
        CHECK (service_tier IS NULL OR service_tier IN ('done_for_you'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_service_status_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_service_status_check
        CHECK (service_status IN ('pending_review', 'approved', 'delivered', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_service_package_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_service_package_check
        CHECK (service_package IS NULL OR service_package IN ('boq_only', 'tender_pack', 'full_submission'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS boqs_service_tier_idx
  ON public.boqs(service_tier) WHERE service_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS boqs_service_status_idx
  ON public.boqs(service_status, service_tier) WHERE service_tier IS NOT NULL;
