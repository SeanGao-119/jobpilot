-- Add SEEK Saved Jobs as an ingestion source without duplicating jobs already seen elsewhere.

alter type job_source add value if not exists 'seek_saved';

create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  source job_source not null,
  source_external_id text,
  source_url text,
  source_message_id text,
  discovered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, source)
);

create index if not exists job_sources_job_id_idx on job_sources(job_id);
create index if not exists job_sources_external_id_idx on job_sources(source_external_id);

-- Backfill the existing primary source so provenance is queryable consistently.
insert into job_sources (
  job_id, source, source_external_id, source_url, source_message_id, discovered_at
)
select id, source, source_external_id, source_url, source_message_id, discovered_at
from jobs
on conflict (job_id, source) do nothing;
