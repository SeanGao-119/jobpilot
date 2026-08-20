import { sql } from "./db";

export type DashboardJob = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  overall_score: number;
  recommendation: "apply" | "consider" | "low" | "skip";
  discovered_at: string;
  source_url: string | null;
  status: string;
};

export type DashboardStats = {
  jobs: number;
  averageMatch: number;
  apply: number;
  consider: number;
  low: number;
  skip: number;
};

export async function getDashboardData(): Promise<{
  stats: DashboardStats;
  jobs: DashboardJob[];
}> {
  const rows = await sql<DashboardJob[]>`
    with latest_matches as (
      select distinct on (job_id)
        job_id,
        overall_score,
        recommendation,
        created_at
      from job_matches
      order by job_id, created_at desc
    )
    select
      j.id::text,
      j.company,
      j.title,
      j.location,
      lm.overall_score::float8 as overall_score,
      lm.recommendation,
      j.discovered_at::text,
      j.source_url,
      coalesce(a.status::text, 'discovered') as status
    from jobs j
    join latest_matches lm on lm.job_id = j.id
    left join applications a on a.job_id = j.id
    order by lm.overall_score desc, j.discovered_at desc
  `;

  const jobs = [...rows];
  const total = jobs.length;
  const averageMatch = total
    ? jobs.reduce((sum, job) => sum + Number(job.overall_score), 0) / total
    : 0;

  return {
    stats: {
      jobs: total,
      averageMatch,
      apply: jobs.filter((job) => job.recommendation === "apply").length,
      consider: jobs.filter((job) => job.recommendation === "consider").length,
      low: jobs.filter((job) => job.recommendation === "low").length,
      skip: jobs.filter((job) => job.recommendation === "skip").length,
    },
    jobs,
  };
}
