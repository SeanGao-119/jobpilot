create table if not exists salary_estimates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  estimate_min numeric,
  estimate_max numeric,
  recommended_ask numeric,
  currency text not null default 'NZD',
  period text not null default 'year' check (period in ('hour', 'day', 'week', 'month', 'year')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  comparable_count integer not null default 0 check (comparable_count >= 0),
  evidence jsonb not null default '[]'::jsonb,
  rationale text,
  source_model text,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (job_id)
);

create index if not exists salary_estimates_job_id_idx on salary_estimates(job_id);
create index if not exists salary_estimates_calculated_at_idx on salary_estimates(calculated_at desc);
