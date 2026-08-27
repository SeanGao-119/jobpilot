-- Canonicalize SEEK jobs so the same SEEK job id deduplicates across discovery channels.
-- Email provenance remains in source_message_id.

update jobs
set source = 'seek_url'::job_source,
    updated_at = now()
where source in ('seek_email'::job_source, 'seek_search'::job_source)
  and source_external_id is not null
  and not exists (
    select 1
    from jobs existing
    where existing.source = 'seek_url'::job_source
      and existing.source_external_id = jobs.source_external_id
      and existing.id <> jobs.id
  );
