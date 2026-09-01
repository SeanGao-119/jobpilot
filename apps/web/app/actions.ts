"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sql } from "../lib/db";

const SEEK_HOSTS = ["seek.co.nz", "seek.com"];
const JOB_ID_RE = /\/job\/(\d+)/;
const DETAIL_QUERY = `
  query jobDetails($jobId: ID!) {
    jobDetails(id: $jobId) {
      job {
        id title content(platform: WEB)
        salary { label }
        workTypes { label }
        advertiser { name }
        location { label }
      }
    }
  }
`;

type SeekJob = {
  id: string;
  title: string;
  content: string;
  salary?: { label?: string | null } | null;
  workTypes?: { label?: string | null } | null;
  advertiser?: { name?: string | null } | null;
  location?: { label?: string | null } | null;
};

function isSeekHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return SEEK_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
}

function parseSeekUrl(value: string) {
  const url = new URL(value.trim());
  if (!(["http:", "https:"].includes(url.protocol)) || !isSeekHost(url.hostname)) {
    throw new Error("Please paste a SEEK job URL.");
  }
  const match = JOB_ID_RE.exec(url.pathname);
  if (!match) throw new Error("No SEEK job ID was found in that URL.");
  return {
    jobId: match[1],
    canonicalUrl: `https://www.seek.co.nz/job/${match[1]}`,
  };
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchSeekJob(jobId: string): Promise<SeekJob> {
  const response = await fetch("https://nz.seek.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 JobPilot/1.0",
    },
    body: JSON.stringify({
      operationName: "jobDetails",
      variables: { jobId },
      query: DETAIL_QUERY,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SEEK returned HTTP ${response.status}.`);
  const payload = await response.json() as {
    data?: { jobDetails?: { job?: SeekJob | null } | null } | null;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || "SEEK could not load this job.");
  }
  const job = payload.data?.jobDetails?.job;
  if (!job?.title || !job.content || !job.advertiser?.name) {
    throw new Error("SEEK job details were incomplete or the job has expired.");
  }
  return job;
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Could not import this SEEK job.";
}

export async function addSeekJobUrl(formData: FormData) {
  let destination = "/";
  try {
    const rawUrl = String(formData.get("url") ?? "");
    const { jobId, canonicalUrl } = parseSeekUrl(rawUrl);

    const existing = await sql<{ id: string; title: string }[]>`
      select id::text, title
      from jobs
      where source_external_id = ${jobId}
        and source_url like '%seek%'
      order by discovered_at asc
      limit 1
    `;
    if (existing.length) {
      destination = `/?imported=${encodeURIComponent(`${existing[0].title} is already in JobPilot`)}`;
    } else {
      const job = await fetchSeekJob(jobId);
      const description = stripHtml(job.content);
      await sql`
        insert into jobs (
          source, source_external_id, source_url,
          ingestion_mode, source_category,
          title, company, location, employment_type, salary_text,
          jd_raw, jd_clean, requirements
        ) values (
          'seek_url'::job_source,
          ${jobId},
          ${canonicalUrl},
          'manual'::ingestion_mode,
          'manual_url'::source_category,
          ${job.title},
          ${job.advertiser?.name ?? "Unknown employer"},
          ${job.location?.label ?? null},
          ${job.workTypes?.label ?? null},
          ${job.salary?.label ?? null},
          ${description},
          ${description},
          '{}'::jsonb
        )
        on conflict (source, source_external_id) do update set
          source_url = excluded.source_url,
          ingestion_mode = excluded.ingestion_mode,
          source_category = excluded.source_category,
          title = excluded.title,
          company = excluded.company,
          location = excluded.location,
          employment_type = excluded.employment_type,
          salary_text = excluded.salary_text,
          jd_raw = excluded.jd_raw,
          jd_clean = excluded.jd_clean,
          updated_at = now()
      `;
      destination = `/?imported=${encodeURIComponent(job.title)}`;
    }
  } catch (error) {
    destination = `/?import_error=${encodeURIComponent(messageFor(error))}`;
  }
  revalidatePath("/");
  redirect(destination);
}
