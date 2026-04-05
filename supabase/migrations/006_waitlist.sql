-- ============================================================
-- 006: Public waitlist signups
-- ============================================================

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT        NOT NULL UNIQUE,
  role        TEXT,
  company     TEXT,
  source      TEXT        NOT NULL DEFAULT 'landing_page',
  status      TEXT        NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT waitlist_signups_status_check
    CHECK (status IN ('pending', 'confirmed', 'contacted', 'unsubscribed'))
);

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
