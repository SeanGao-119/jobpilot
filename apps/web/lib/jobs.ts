import { sql } from "./db";

export type JobDetail = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  source_url: string | null;
  employment_type: string | null;
  salary_text: string | null;
  jd_clean: string | null;
  requirements: unknown;
  discovered_at: string;
  overall_score: number;
  technical_score: number | null;
  experience_score: number | null;
  education_score: number | null;
  domain_score: number | null;
  seniority_score: number | null;
  location_score: number | null;
  work_rights_score: number | null;
  recommendation: string;
  matched_evidence: unknown;
  partial_evidence: unknown;
  gaps: unknown;
  explanation: string | null;
  status: string;
  applied_at: string | null;
  salary_estimate_min: number | null;
  salary_estimate_max: number | null;
  salary_recommended_ask: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_confidence: string | null;
  salary_comparable_count: number | null;
  salary_rationale: string | null;
};

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const rows = await sql<JobDetail[]>`
    with latest_match as (
      select *
      from job_matches
      where job_id = ${id}::uuid
      order by created_at desc
      limit 1
    )
    select
      j.id::text,
      j.company,
      j.title,
      j.location,
      j.source_url,
      j.employment_type,
      j.salary_text,
      j.jd_clean,
      j.requirements,
      j.discovered_at::text,
      lm.overall_score::float8,
      lm.technical_score::float8,
      lm.experience_score::float8,
      lm.education_score::float8,
      lm.domain_score::float8,
      lm.seniority_score::float8,
      lm.location_score::float8,
      lm.work_rights_score::float8,
      lm.recommendation,
      lm.matched_evidence,
      lm.partial_evidence,
      lm.gaps,
      lm.explanation,
      coalesce(a.status::text, 'discovered') as status,
      a.applied_at::text,
      s.estimate_min::float8 as salary_estimate_min,
      s.estimate_max::float8 as salary_estimate_max,
      s.recommended_ask::float8 as salary_recommended_ask,
      s.currency as salary_currency,
      s.period as salary_period,
      s.confidence as salary_confidence,
      s.comparable_count as salary_comparable_count,
      s.rationale as salary_rationale
    from jobs j
    join latest_match lm on lm.job_id = j.id
    left join applications a on a.job_id = j.id
    left join salary_estimates s on s.job_id = j.id
    where j.id = ${id}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}
