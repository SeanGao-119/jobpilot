"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sql } from "../lib/db";
import {
  canonicalJobUrl,
  detectPlatform,
  externalIdForUrl,
  fetchPublicJobPosting,
  sourceForPlatform,
  type OpportunityKind,
  type ParsedJobPosting,
} from "../lib/job-sources";

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
  return error instanceof Error ? error.message : "Could not import this opportunity.";
}

function opportunityKind(value: FormDataEntryValue | null): OpportunityKind {
  if (value === "recruiter" || value === "network") return value;
  return "job";
}

function manualText(formData: FormData, key: string, max: number) {
  return String(formData.get(key) ?? "").trim().slice(0, max) || null;
}

export async function addJobUrl(formData: FormData) {
  let destination = "/";
  try {
    const rawUrl = String(formData.get("url") ?? "");
    const detected = detectPlatform(rawUrl);
    const kind = opportunityKind(formData.get("opportunity_kind"));
    if (detected.platform !== "linkedin" && kind !== "job") {
      throw new Error("Recruiter and network entries currently require a LinkedIn URL.");
    }
    const externalId = externalIdForUrl(detected.platform, detected.url);
    const canonicalUrl = canonicalJobUrl(detected.platform, detected.url, externalId);
    const source = sourceForPlatform(detected.platform);

    const existing = await sql<{ id: string; title: string }[]>`
      select id::text, title
      from jobs
      where source_external_id = ${externalId}
        and platform = ${detected.platform}::job_platform
      order by discovered_at asc
      limit 1
    `;
    if (existing.length) {
      destination = `/?imported=${encodeURIComponent(`${existing[0].title} is already in JobPilot`)}`;
    } else {
      let parsed: ParsedJobPosting = {
        title: null, company: null, location: null, employmentType: null,
        salaryText: null, description: null, postedAt: null, expiresAt: null,
      };
      if (detected.platform === "seek" && kind === "job" && /^\d+$/.test(externalId)) {
        const job = await fetchSeekJob(externalId);
        parsed = {
          title: job.title,
          company: job.advertiser?.name ?? null,
          location: job.location?.label ?? null,
          employmentType: job.workTypes?.label ?? null,
          salaryText: job.salary?.label ?? null,
          description: stripHtml(job.content),
          postedAt: null,
          expiresAt: null,
        };
      } else if (kind === "job") {
        try {
          parsed = await fetchPublicJobPosting(canonicalUrl);
        } catch (error) {
          if (!manualText(formData, "title", 180) || !manualText(formData, "company", 180)) throw error;
        }
      }

      const title = manualText(formData, "title", 180)
        ?? parsed.title
        ?? (kind === "recruiter" ? "Recruiter conversation" : "Professional connection");
      const company = manualText(formData, "company", 180)
        ?? parsed.company
        ?? (kind === "job" ? `${detected.platform.toUpperCase()} employer` : "LinkedIn");
      const description = manualText(formData, "description", 16000) ?? parsed.description ?? "";
      const category = kind === "job" ? "manual_url" : kind;
      await sql`
        insert into jobs (
          source, source_external_id, source_url,
          ingestion_mode, source_category, platform, opportunity_kind,
          title, company, location, employment_type, salary_text,
          jd_raw, jd_clean, requirements, posted_at, expires_at
        ) values (
          ${source}::job_source,
          ${externalId},
          ${canonicalUrl},
          'manual'::ingestion_mode,
          ${category}::source_category,
          ${detected.platform}::job_platform,
          ${kind}::opportunity_kind,
          ${title},
          ${company},
          ${parsed.location},
          ${parsed.employmentType},
          ${parsed.salaryText},
          ${description},
          ${description},
          '{}'::jsonb,
          ${parsed.postedAt},
          ${parsed.expiresAt}
        )
        on conflict (source, source_external_id) do update set
          source_url = excluded.source_url,
          ingestion_mode = excluded.ingestion_mode,
          source_category = excluded.source_category,
          platform = excluded.platform,
          opportunity_kind = excluded.opportunity_kind,
          title = excluded.title,
          company = excluded.company,
          location = excluded.location,
          employment_type = excluded.employment_type,
          salary_text = excluded.salary_text,
          jd_raw = excluded.jd_raw,
          jd_clean = excluded.jd_clean,
          updated_at = now()
      `;
      destination = `/?imported=${encodeURIComponent(`${title} added from ${detected.platform}`)}`;
    }
  } catch (error) {
    destination = `/?import_error=${encodeURIComponent(messageFor(error))}`;
  }
  revalidatePath("/");
  redirect(destination);
}
