-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Rate library table with vector embeddings
create table if not exists rate_library (
  id           bigserial primary key,
  description  text not null,
  unit         text not null,
  rate         numeric not null,
  project      text,
  province     text,
  project_type text,
  source       text not null default 'historical', -- 'historical' | 'zppa'
  embedding    vector(768)
);

-- IVFFlat index for fast cosine similarity search
-- lists = 50 is appropriate for < 10k rows; increase to 100+ once library grows
create index if not exists rate_library_embedding_idx
  on rate_library using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- RPC function for nearest-neighbour rate lookup
create or replace function match_rate_library(
  query_embedding  vector(768),
  match_count      int,
  filter_province  text default null,
  filter_unit      text default null
)
returns table (
  id           bigint,
  description  text,
  unit         text,
  rate         numeric,
  project      text,
  province     text,
  project_type text,
  source       text,
  similarity   float
)
language plpgsql as $$
begin
  return query
  select
    r.id,
    r.description,
    r.unit,
    r.rate,
    r.project,
    r.province,
    r.project_type,
    r.source,
    1 - (r.embedding <=> query_embedding) as similarity
  from rate_library r
  where
    (filter_province is null or r.province = filter_province)
    and (filter_unit is null or r.unit = filter_unit)
  order by r.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Review status on BOQs: 'pending' until QS approves rates
alter table boqs add column if not exists review_status text not null default 'pending';
