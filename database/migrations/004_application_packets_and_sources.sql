-- V0.6: multi-source opportunity ingestion and normalized application packets.

alter type job_source add value if not exists 'linkedin_email';
alter type job_source add value if not exists 'linkedin_url';
alter type job_source add value if not exists 'zeil_url';
alter type job_source add value if not exists 'trademe_url';

alter type source_category add value if not exists 'recruiter';
alter type source_category add value if not exists 'network';

do $$ begin
  create type job_platform as enum ('seek', 'linkedin', 'zeil', 'trademe', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type opportunity_kind as enum ('job', 'recruiter', 'network');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type evidence_status as enum ('verified', 'draft', 'needs_review');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type evidence_selection_mode as enum ('auto', 'manual');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type packet_status as enum ('needs_review', 'ready_to_apply');
exception when duplicate_object then null;
end $$;

alter table jobs add column if not exists platform job_platform not null default 'other';
alter table jobs add column if not exists opportunity_kind opportunity_kind not null default 'job';

update jobs set platform = case
  when source::text like 'seek_%' then 'seek'::job_platform
  when source::text like 'linkedin_%' then 'linkedin'::job_platform
  when source::text = 'zeil_url' then 'zeil'::job_platform
  when source::text = 'trademe_url' then 'trademe'::job_platform
  else 'other'::job_platform
end;

create index if not exists jobs_platform_idx on jobs (platform);
create index if not exists jobs_opportunity_kind_idx on jobs (opportunity_kind);

create table if not exists evidence_controls (
  evidence_id text primary key,
  status evidence_status not null default 'verified',
  locked boolean not null default false,
  content_hash text not null,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists job_evidence_preferences (
  job_id uuid primary key references jobs(id) on delete cascade,
  selection_mode evidence_selection_mode not null default 'auto',
  updated_at timestamptz not null default now()
);

create table if not exists job_evidence_selections (
  job_id uuid not null references jobs(id) on delete cascade,
  evidence_id text not null,
  created_at timestamptz not null default now(),
  primary key (job_id, evidence_id)
);

create table if not exists application_packets (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  packet_version text not null,
  status packet_status not null,
  target_profile jsonb not null,
  requirement_map jsonb not null,
  resume_plan jsonb not null,
  final_resume jsonb not null,
  resume_hash text not null,
  cover_letter_mapping jsonb not null,
  qa_report jsonb not null,
  provider text not null,
  created_at timestamptz not null default now()
);

create index if not exists application_packets_application_idx
  on application_packets(application_id, created_at desc);

create table if not exists application_packet_evidence (
  packet_id uuid not null references application_packets(id) on delete cascade,
  evidence_id text not null,
  usage text not null check (usage in ('resume', 'cover_letter')),
  paragraph_number integer not null default 0,
  primary key (packet_id, evidence_id, usage, paragraph_number)
);

alter table generated_documents
  add column if not exists packet_id uuid references application_packets(id) on delete set null;
