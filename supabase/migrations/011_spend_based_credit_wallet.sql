-- ============================================================
-- 011: Spend-based credit wallet
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_credits_balance INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS wallet_credits_granted_at TIMESTAMPTZ;

ALTER TABLE public.credit_events
  ADD COLUMN IF NOT EXISTS delta_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS balance_after INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_events_reason_check'
  ) THEN
    ALTER TABLE public.credit_events
      DROP CONSTRAINT credit_events_reason_check;
  END IF;

  ALTER TABLE public.credit_events
    ADD CONSTRAINT credit_events_reason_check
    CHECK (reason IN ('starter_grant', 'starter_reset', 'generate_boq', 'rate_boq', 'assistant_boq', 'manual_refund'));
END $$;

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS ai_input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_total_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_credits_charged INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_usage_breakdown JSONB;

WITH initialized_profiles AS (
  UPDATE public.profiles
  SET wallet_credits_granted_at = NOW()
  WHERE wallet_credits_granted_at IS NULL
  RETURNING id, wallet_credits_balance
)
INSERT INTO public.credit_events (
  user_id,
  delta,
  delta_usd,
  balance_after,
  reason,
  reference_type,
  reference_id,
  metadata
)
SELECT
  p.id,
  p.wallet_credits_balance,
  2.5,
  p.wallet_credits_balance,
  'starter_reset',
  'migration',
  '011_spend_based_credit_wallet',
  jsonb_build_object('migration', '011_spend_based_credit_wallet')
FROM initialized_profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.credit_events e
  WHERE e.user_id = p.id
    AND e.reason = 'starter_reset'
    AND e.reference_type = 'migration'
    AND e.reference_id = '011_spend_based_credit_wallet'
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    free_boq_credits_balance,
    starter_credits_granted_at,
    wallet_credits_balance,
    wallet_credits_granted_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    0,
    NOW(),
    1000,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credit_events (
    user_id,
    delta,
    delta_usd,
    balance_after,
    reason,
    reference_type,
    reference_id,
    metadata
  )
  VALUES (
    NEW.id,
    1000,
    2.5,
    1000,
    'starter_grant',
    'profile',
    NEW.id::text,
    jsonb_build_object('wallet_credits', 1000, 'usd_value', 2.5)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_wallet_credits(
  p_user_id UUID,
  p_reason TEXT,
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_credits INTEGER,
  p_delta_usd NUMERIC,
  p_metadata JSONB DEFAULT NULL
)
RETURNS TABLE(status TEXT, remaining_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
  credits_to_consume INTEGER := GREATEST(COALESCE(p_credits, 0), 0);
BEGIN
  SELECT wallet_credits_balance
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

  IF current_balance <= 0 AND credits_to_consume > 0 THEN
    RETURN QUERY SELECT 'insufficient'::TEXT, current_balance;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET wallet_credits_balance = wallet_credits_balance - credits_to_consume
  WHERE id = p_user_id
  RETURNING wallet_credits_balance INTO current_balance;

  INSERT INTO public.credit_events (
    user_id,
    delta,
    delta_usd,
    balance_after,
    reason,
    reference_type,
    reference_id,
    metadata
  )
  VALUES (
    p_user_id,
    -credits_to_consume,
    -ABS(COALESCE(p_delta_usd, 0)),
    current_balance,
    p_reason,
    p_reference_type,
    p_reference_id,
    p_metadata
  );

  RETURN QUERY SELECT 'consumed'::TEXT, current_balance;
END;
$$;
