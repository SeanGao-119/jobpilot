import { sql } from "./db";
import { dashboardFixture } from "./qa-fixtures";

export type DashboardJob = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  overall_score: number | null;
  recommendation: "apply" | "consider" | "low" | "skip" | null;
  discovered_at: string;
  source_url: string | null;
  ingestion_mode: "manual" | "automatic";
  source_category: "manual_url" | "job_alert" | "recommendation" | "recruiter" | "network" | "other";
  platform: "seek" | "linkedin" | "zeil" | "trademe" | "other";
  opportunity_kind: "job" | "recruiter" | "network";
  status: string;
};

export type DashboardStats = {
  jobs: number;
  averageMatch: number;
  apply: number;
  consider: number;
  low: number;
  skip: number;
  archived: number;
  newToday: number;
};

export async function getDashboardData(): Promise<{
  stats: DashboardStats;
  jobs: DashboardJob[];
}> {
  if (process.env.JOBPILOT_QA_FIXTURE === "1") return dashboardFixture() as { stats: DashboardStats; jobs: DashboardJob[] };
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
      j.ingestion_mode::text,
      j.source_category::text,
      j.platform::text,
      j.opportunity_kind::text,
      coalesce(a.status::text, 'discovered') as status
    from jobs j
    left join latest_matches lm on lm.job_id = j.id
    left join applications a on a.job_id = j.id
    order by lm.overall_score desc nulls last, j.discovered_at desc
  `;

  const archived = rows.filter((job) => job.status === "skipped");
  const jobs = rows.filter((job) => job.status !== "skipped");
  const scored = jobs.filter((job) => job.overall_score !== null);
  const averageMatch = scored.length
    ? scored.reduce((sum, job) => sum + Number(job.overall_score), 0) / scored.length
    : 0;
  const today = new Date();
  const newToday = jobs.filter((job) => {
    const discovered = new Date(job.discovered_at);
    return discovered.getFullYear() === today.getFullYear()
      && discovered.getMonth() === today.getMonth()
      && discovered.getDate() === today.getDate();
  }).length;

  return {
    stats: {
      jobs: jobs.length,
      averageMatch,
      apply: jobs.filter((job) => job.recommendation === "apply").length,
      consider: jobs.filter((job) => job.recommendation === "consider").length,
      low: jobs.filter((job) => job.recommendation === "low").length,
      skip: jobs.filter((job) => job.recommendation === "skip").length,
      archived: archived.length,
      newToday,
    },
    jobs,
  };
}
