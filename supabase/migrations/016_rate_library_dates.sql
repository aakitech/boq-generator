-- Add temporal columns to rate_library
-- created_at: when the entry was ingested into the DB
-- rate_date:  when the project was actually priced (year or month precision is fine)
--             NULL for entries where we don't know yet

ALTER TABLE public.rate_library
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS rate_date  DATE         NULL;

-- Backfill created_at for existing rows (we don't know exact time, use epoch as sentinel)
-- Leave NULL rows for rate_date — will be updated once we have dates from Innocent
UPDATE public.rate_library
SET created_at = NOW()
WHERE created_at IS NULL;

-- ZPPA Q2 2026 entries have a known date
UPDATE public.rate_library
SET rate_date = '2026-04-01'
WHERE source = 'zppa';

-- Update match_rate_library RPC to expose rate_date so callers can see it
-- Must DROP first — PostgreSQL won't allow changing a function's return type in place
DROP FUNCTION IF EXISTS match_rate_library(vector(768), int, text, text);
CREATE OR REPLACE FUNCTION match_rate_library(
  query_embedding  vector(768),
  match_count      int,
  filter_province  text default null,
  filter_unit      text default null
)
RETURNS TABLE (
  id           bigint,
  description  text,
  unit         text,
  rate         numeric,
  project      text,
  province     text,
  project_type text,
  source       text,
  rate_date    date,
  similarity   float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.description,
    r.unit,
    r.rate,
    r.project,
    r.province,
    r.project_type,
    r.source,
    r.rate_date,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM rate_library r
  WHERE
    (filter_province IS NULL OR r.province = filter_province)
    AND (filter_unit IS NULL OR r.unit = filter_unit)
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
