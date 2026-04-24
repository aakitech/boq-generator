-- ============================================================
-- 012: Go-live credit updates
-- ============================================================

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
    1.0,
    1000,
    'starter_grant',
    'profile',
    NEW.id::text,
    jsonb_build_object('wallet_credits', 1000, 'usd_value', 1.0)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
