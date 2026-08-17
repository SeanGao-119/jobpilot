-- JobPilot initial PostgreSQL schema

create extension if not exists pgcrypto;

create type job_source as enum ('seek_email', 'seek_url', 'seek_search', 'manual');
create type application_status as enum (
  'discovered',
  'analyzed',
  'shortlisted',
  'documents_ready',
  'applied',
  'screening',
  'interview',
  'final_interview',
  'offer',
  'rejected',
  'withdrawn',
  'expired',
  'skipped'
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  source job_source not null,
  source_external_id text,
  source_url text,
  source_message_id text,

  title text not null,
  company text not null,
  location text,
  work_arrangement text,
  employment_type text,
  salary_text text,
  salary_min numeric,
  salary_max numeric,
  currency text default 'NZD',

  jd_raw text,
  jd_clean text,
  requirements jsonb not null default '{}'::jsonb,

  discovered_at timestamptz not null default now(),
  posted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source, source_external_id)
);

create index if not exists jobs_company_title_idx on jobs (lower(company), lower(title));
create index if not exists jobs_discovered_at_idx on jobs (discovered_at desc);

create table if not exists job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  profile_version text not null,
  prompt_version text,

  overall_score numeric(5,2) not null check (overall_score between 0 and 100),
  technical_score numeric(5,2) check (technical_score between 0 and 100),
  experience_score numeric(5,2) check (experience_score between 0 and 100),
  education_score numeric(5,2) check (education_score between 0 and 100),
  domain_score numeric(5,2) check (domain_score between 0 and 100),
  seniority_score numeric(5,2) check (seniority_score between 0 and 100),
  location_score numeric(5,2) check (location_score between 0 and 100),
  work_rights_score numeric(5,2) check (work_rights_score between 0 and 100),

  recommendation text not null check (recommendation in ('apply', 'consider', 'low', 'skip')),
  matched_evidence jsonb not null default '[]'::jsonb,
  partial_evidence jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  explanation text,
  created_at timestamptz not null default now()
);

create index if not exists job_matches_job_id_idx on job_matches(job_id);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  status application_status not null default 'discovered',

  generated_at timestamptz,
  applied_at timestamptz,
  resume_path text,
  cover_letter_path text,
  resume_git_commit text,
  application_method text,
  external_application_id text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(job_id)
);

create index if not exists applications_status_idx on applications(status);
create index if not exists applications_applied_at_idx on applications(applied_at desc);

create table if not exists application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  event_type text not null,
  from_status application_status,
  to_status application_status,
  source text not null default 'manual',
  source_message_id text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists application_events_application_idx
  on application_events(application_id, occurred_at desc);

create table if not exists generated_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  document_type text not null check (document_type in ('resume', 'cover_letter')),
  format text not null check (format in ('tex', 'pdf', 'txt', 'md')),
  storage_path text not null,
  generator_version text,
  source_profile_version text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists generated_documents_application_idx
  on generated_documents(application_id);

-- A job's raw source is retained for provenance; secrets and OAuth credentials never belong here.
