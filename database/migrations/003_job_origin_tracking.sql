-- Track how each job entered JobPilot and which SEEK channel produced it.

do $$
begin
  create type ingestion_mode as enum ('manual', 'automatic');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type source_category as enum ('manual_url', 'job_alert', 'recommendation', 'other');
exception
  when duplicate_object then null;
end $$;

alter table jobs
  add column if not exists ingestion_mode ingestion_mode not null default 'automatic',
  add column if not exists source_category source_category not null default 'other';

-- Existing email imports were produced by the recommendation-email pipeline.
update jobs
set ingestion_mode = 'automatic'::ingestion_mode,
    source_category = 'recommendation'::source_category
where source = 'seek_email'::job_source
  and source_category = 'other'::source_category;

update jobs
set ingestion_mode = 'manual'::ingestion_mode,
    source_category = 'manual_url'::source_category
where source in ('seek_url'::job_source, 'manual'::job_source);

create index if not exists jobs_ingestion_mode_idx on jobs (ingestion_mode);
create index if not exists jobs_source_category_idx on jobs (source_category);
