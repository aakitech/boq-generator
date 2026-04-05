-- ============================================================
-- 007: Ensure waitlist_signups has the full expected schema
-- ============================================================

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
);

ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'landing_page',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.waitlist_signups
SET source = 'landing_page'
WHERE source IS NULL;

UPDATE public.waitlist_signups
SET status = 'pending'
WHERE status IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waitlist_signups_status_check'
  ) THEN
    ALTER TABLE public.waitlist_signups
      ADD CONSTRAINT waitlist_signups_status_check
      CHECK (status IN ('pending', 'confirmed', 'contacted', 'unsubscribed'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waitlist_signups_email_key'
  ) THEN
    ALTER TABLE public.waitlist_signups
      ADD CONSTRAINT waitlist_signups_email_key UNIQUE (email);
  END IF;
END $$;

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'waitlist_signups'
      AND policyname = 'waitlist_signups_insert_service'
  ) THEN
    CREATE POLICY waitlist_signups_insert_service
      ON public.waitlist_signups
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS waitlist_signups_set_updated_at ON public.waitlist_signups;
CREATE TRIGGER waitlist_signups_set_updated_at
  BEFORE UPDATE ON public.waitlist_signups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx
  ON public.waitlist_signups(created_at DESC);
