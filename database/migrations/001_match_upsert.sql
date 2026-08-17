-- Allow deterministic upserts for rescoring the same job/profile pair.

create unique index if not exists job_matches_job_profile_uidx
  on job_matches(job_id, profile_version);
