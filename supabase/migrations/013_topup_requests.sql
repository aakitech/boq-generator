-- ============================================================
-- 013: Top-up requests table for credit wallet top-ups
-- ============================================================

CREATE TABLE IF NOT EXISTS topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_usd int NOT NULL,
  credits_to_grant int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reference text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

ALTER TABLE topup_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'topup_requests' AND policyname = 'Users can view own topup requests'
  ) THEN
    CREATE POLICY "Users can view own topup requests"
      ON topup_requests FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'topup_requests' AND policyname = 'Users can insert own topup requests'
  ) THEN
    CREATE POLICY "Users can insert own topup requests"
      ON topup_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
