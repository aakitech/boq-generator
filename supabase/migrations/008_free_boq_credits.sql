-- ============================================================
-- 008: Starter free BOQ credits
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_boq_credits_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starter_credits_granted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.credit_events (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta          INTEGER     NOT NULL,
  reason         TEXT        NOT NULL,
  reference_type TEXT,
  reference_id   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_events_reason_check
    CHECK (reason IN ('starter_grant', 'generate_boq', 'rate_boq', 'manual_refund'))
);

ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_events' AND policyname='credit_events_select_own') THEN
    CREATE POLICY credit_events_select_own ON public.credit_events
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_events' AND policyname='credit_events_insert_service') THEN
    CREATE POLICY credit_events_insert_service ON public.credit_events
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS credit_events_reference_unique_idx
  ON public.credit_events(user_id, reason, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_events_user_id_idx
  ON public.credit_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    free_boq_credits_balance,
    starter_credits_granted_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    8,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credit_events (user_id, delta, reason, reference_type, reference_id)
  VALUES (NEW.id, 8, 'starter_grant', 'profile', NEW.id::text)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_free_boq_credit(
  p_user_id UUID,
  p_reason TEXT,
  p_reference_type TEXT,
  p_reference_id TEXT
)
RETURNS TABLE(status TEXT, remaining_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  SELECT free_boq_credits_balance
  INTO current_balance
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user %', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.credit_events
    WHERE user_id = p_user_id
      AND reason = p_reason
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
  ) THEN
    RETURN QUERY SELECT 'already_consumed'::TEXT, current_balance;
    RETURN;
  END IF;

  IF current_balance <= 0 THEN
    RETURN QUERY SELECT 'insufficient'::TEXT, 0;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET free_boq_credits_balance = free_boq_credits_balance - 1
  WHERE id = p_user_id
  RETURNING free_boq_credits_balance INTO current_balance;

  INSERT INTO public.credit_events (user_id, delta, reason, reference_type, reference_id)
  VALUES (p_user_id, -1, p_reason, p_reference_type, p_reference_id);

  RETURN QUERY SELECT 'consumed'::TEXT, current_balance;
END;
$$;
