-- Fix embedding column to 768 dims (using outputDimensionality truncation)
-- and create index + RPC. Run after 014 which created the table.

ALTER TABLE rate_library DROP COLUMN IF EXISTS embedding;
ALTER TABLE rate_library ADD COLUMN embedding vector(768);

CREATE INDEX IF NOT EXISTS rate_library_embedding_idx
  ON rate_library USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION match_rate_library(
  query_embedding  vector(768),
  match_count      int,
  filter_province  text default null,
  filter_unit      text default null
)
RETURNS TABLE (
  id bigint, description text, unit text, rate numeric,
  project text, province text, project_type text, source text, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.description, r.unit, r.rate, r.project, r.province,
         r.project_type, r.source,
         1 - (r.embedding <=> query_embedding) AS similarity
  FROM rate_library r
  WHERE (filter_province IS NULL OR r.province = filter_province)
    AND (filter_unit IS NULL OR r.unit = filter_unit)
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

ALTER TABLE boqs ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';
